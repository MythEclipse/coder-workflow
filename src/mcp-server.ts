#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { QualityGateThreshold } from "./analysis.js";
import {
  analyzeGraphQuality,
  analyzeImpact,
  evaluateQualityGate,
  findCycles,
  findOrphans,
  queryGraph,
  summarizeArchitecture,
} from "./analysis.js";
import { exportGraph } from "./exporters.js";
import { getDirectoryTree } from "./fs-tools.js";
import { diffGraphs, formatGraphDiff } from "./git-diff.js";
import { summarizeGraphForBudget } from "./graph/summarize.js";
import { graphExists, readGraph, scanCodebase, writeGraph } from "./graph.js";
import { searchCodebase } from "./search.js";
import { loadSettings } from "./settings.js";
import type { CodeGraph } from "./types.js";
import { openGraphUi } from "./ui.js";

let _cachedGraph: CodeGraph | null = null;
let _cachedGraphMtime = 0;

// ─── RW Lock (prevents cache serving while scan/update is in-flight) ───
// Mutating tools (scan_codebase, update_codebase) acquire the write lock.
// Reading tools wait for any active writer before accessing the cached graph.
// This prevents concurrent async hook updates from racing with MCP reads.

interface RWLock {
  readers: number;
  writer: boolean;
  pending: Array<() => void>;
}

function createRWLock(): RWLock {
  return { readers: 0, writer: false, pending: [] };
}

function acquireRead(lock: RWLock): Promise<void> {
  return new Promise((resolve) => {
    if (!lock.writer && lock.pending.length === 0) {
      lock.readers++;
      resolve();
    } else {
      lock.pending.push(() => {
        lock.readers++;
        resolve();
      });
    }
  });
}

function releaseRead(lock: RWLock): void {
  lock.readers--;
  drainPending(lock);
}

function acquireWrite(lock: RWLock): Promise<void> {
  return new Promise((resolve) => {
    if (lock.readers === 0 && !lock.writer) {
      lock.writer = true;
      resolve();
    } else {
      lock.pending.push(() => {
        lock.writer = true;
        resolve();
      });
    }
  });
}

function releaseWrite(lock: RWLock): void {
  lock.writer = false;
  drainPending(lock);
}

function drainPending(lock: RWLock): void {
  while (lock.pending.length > 0) {
    if (lock.writer || lock.readers > 0) break;
    const next = lock.pending.shift()!;
    next();
    // if the first waiter was a writer it stops further draining until released
    if (lock.writer) break;
  }
}

const _graphLock = createRWLock();

/**
 * Get max mtime across main DB and WAL sidecar files.
 * WAL mode writes to graph.db-wal before checkpointing into graph.db.
 */
function getDbMaxMtime(dbPath: string): number {
  let maxMtime = 0;
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of files) {
    if (existsSync(file)) {
      try {
        const stat = statSync(file);
        maxMtime = Math.max(maxMtime, stat.mtimeMs);
      } catch {
        // ignore stat errors
      }
    }
  }
  return maxMtime;
}

async function getCachedGraph(root: string): Promise<CodeGraph> {
  await acquireRead(_graphLock);
  try {
    const dbPath = join(root, ".codegraph", "graph.db");
    try {
      const mtime = getDbMaxMtime(dbPath);
      if (_cachedGraph && _cachedGraphMtime === mtime) {
        return _cachedGraph;
      }
      _cachedGraph = await readGraph(root);
      _cachedGraphMtime = mtime;
      return _cachedGraph;
    } catch {
      return readGraph(root);
    }
  } finally {
    releaseRead(_graphLock);
  }
}

const server = new Server(
  { name: "codegraph-mapper", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ─── Server uptime tracking (for health checks) ───
import {
  compress,
  decompress,
  getStats as getCompressionStats,
  cleanCCR,
  alignCache,
  getCacheAlignment,
} from "./compress.js";
import {
  logFailure,
  getFailures,
  analyzeFailures,
  applyCorrections,
  getLearnReport,
  resolveFailure,
  addCorrection,
  matchCorrection,
} from "./learn.js";
import {
  storeMemory,
  queryMemory,
  getAllMemories,
  getMemoryById,
  deleteMemory as deleteAgentMemory,
  getMemoryStats,
  exportToMarkdown as exportMemoryToMarkdown,
  syncWithPlatform,
  getSupportedPlatforms,
} from "./cross-agent-memory.js";

const _serverStartTime = Date.now();
let _toolCallCount = 0;
let _lastToolCallTime = 0;

// ─── Tool timeout (prevents stalled scan requests from blocking the server) ───
const SCAN_TIMEOUT_MS = 5 * 60_000; // 5 minutes for full scan

async function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Tool "${toolName}" timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function readThreshold(value: unknown): QualityGateThreshold | undefined {
  if (value === "high" || value === "medium" || value === "low") return value;
  if (value === undefined) return undefined;
  throw new Error("Invalid threshold. Use high, medium, or low.");
}

function failingIssuesForThreshold(
  report: ReturnType<typeof analyzeGraphQuality>,
  threshold: QualityGateThreshold,
) {
  const rank: Record<QualityGateThreshold, number> = { low: 1, medium: 2, high: 3 };
  return report.issues.filter((issue) => rank[issue.severity] >= rank[threshold]);
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "scan_codebase",
      description:
        "Build or refresh graph before broad exploration, architecture analysis, dependency lookup, flow tracing, impact review.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "update_codebase",
      description: "Update the graph database for only the files that have changed since the last scan.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "query_graph",
      description:
        "Query before normal search/grep for definitions, references, callers, callees, imports, exports, dependencies, routes, handlers, components, file/symbol relationships.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number", description: "Maximum number of nodes to return" },
        },
        required: ["query"],
      },
    },
    {
      name: "export_graph",
      description: "Export JSON, Mermaid, DOT/Graphviz, Markdown, standalone HTML.",
      inputSchema: {
        type: "object",
        properties: { formats: { type: "array", items: { type: "string" } } },
      },
    },
    {
      name: "search_code",
      description:
        "Search source text across project files. IMPORTANT: By default, this is a literal string search. If your pattern uses regex syntax (e.g. 'a|b'), you MUST set 'regex': true.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The literal string or regex pattern to search for." },
          regex: { type: "boolean", description: "Set to true if pattern is a regular expression. Default is false (literal)." },
          caseSensitive: { type: "boolean", description: "Default is false (case-insensitive)." },
          contextLines: { type: "number", description: "Number of context lines before and after match." },
          maxResults: { type: "number", description: "Maximum number of results to return." },
          maxFileSizeBytes: { type: "number" },
          include: { type: "array", items: { type: "string" }, description: "Glob patterns to include" },
          exclude: { type: "array", items: { type: "string" }, description: "Glob patterns to exclude" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "analyze_impact",
      description:
        "Analyze upstream/downstream impact before broad search for refactors, PR review, dependency risk, change planning, affected files/symbols.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          direction: {
            type: "string",
            enum: ["upstream", "downstream", "both"],
            description: "Direction to traverse the graph.",
          },
        },
        required: ["target"],
      },
    },
    {
      name: "open_graph_ui",
      description:
        "Start local graph UI for interactive architecture/dependency/relationship/impact exploration.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "find_cycles",
      description: "Detect circular dependencies before manual search.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "find_orphans",
      description: "Identify orphan files/symbols before manual inspection.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "summarize_architecture",
      description:
        "Graph‑backed architecture, entry points, modules, dependencies, hotspots before broad exploration.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "analyze_quality",
      description:
        "Analyze codebase graph quality for unresolved imports, stale data, duplicates, and relationship coverage.",
      inputSchema: {
        type: "object",
        properties: { failOn: { type: "string", enum: ["high", "medium", "low"] } },
      },
    },
    {
      name: "quality_gate",
      description: "Evaluate quality gate against a threshold.",
      inputSchema: {
        type: "object",
        properties: {
          threshold: { type: "string", enum: ["high", "medium", "low"] },
          includeReport: { type: "boolean" },
        },
        required: ["threshold"],
      },
    },
    {
      name: "list_directory_tree",
      description: "Visualizes the project directory structure as a nested JSON tree.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          maxDepth: { type: "number" },
        },
      },
    },
    {
      name: "summarize_graph",
      description:
        "Return bounded graph summary with omitted counts, hotspots, and graph freshness (ageMinutes).",
      inputSchema: {
        type: "object",
        properties: {
          maxNodes: { type: "number" },
          maxEdges: { type: "number" },
        },
      },
    },
    {
      name: "check_graph_freshness",
      description:
        "Check if the CodeGraph database is fresh. Returns age in minutes and staleness status. Recommended before deep analysis or architecture audits.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "ping",
      description: "Health check — returns server uptime, cache status, and connection state. Use to verify the MCP server is responsive before initiating long-running operations.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "diff_graphs",
      description: "Compare structural differences before and after a code change.",
      inputSchema: {
        type: "object",
        properties: {
          beforePath: { type: "string", description: "Path to before.json" },
          afterPath: { type: "string", description: "Path to after.json" },
        },
        required: ["beforePath", "afterPath"],
      },
    },

    // ─── Headroom: CCR Compression Tools ───────────────────────────────
    {
      name: "compress_content",
      description:
        "Headroom CCR — Compress content (json/code/prose) to reduce token usage by 60-95%. Supports reversible compression. Store original to .claude/ccr/ for on-demand retrieval.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The content to compress" },
          contentType: {
            type: "string",
            enum: ["auto", "json", "code", "prose"],
            description: "Content type hint. auto = auto-detect.",
          },
          filePath: { type: "string", description: "File path for code compression (enables AST-aware)" },
        },
        required: ["content"],
      },
    },
    {
      name: "decompress_content",
      description:
        "Headroom CCR — Retrieve original content that was compressed. Restores content stored in .claude/ccr/ by its CCR ID.",
      inputSchema: {
        type: "object",
        properties: {
          ccrId: { type: "string", description: "The CCR ID returned by compress_content" },
        },
        required: ["ccrId"],
      },
    },
    {
      name: "ccr_stats",
      description: "Headroom CCR — Get compression statistics: total compressed entries, breakdown by type, storage usage.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "clean_ccr",
      description: "Headroom CCR — Purge expired compressed content older than maxAgeHours (default: 24h).",
      inputSchema: {
        type: "object",
        properties: {
          maxAgeHours: { type: "number", description: "Max age in hours before purging (default: 24)" },
        },
      },
    },

    // ─── Headroom: CacheAligner Tools ──────────────────────────────────
    {
      name: "align_cache",
      description:
        "Headroom CacheAligner — Wrap content with a standardized prefix for KV cache optimization. Use before sending prompts to LLM to increase cache hit rates.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Content to align with cache-friendly prefix" },
          type: {
            type: "string",
            enum: ["system", "agent", "skill", "default"],
            description: "Prefix category",
          },
          subType: { type: "string", description: "Specific agent/skill name e.g. 'implementer', 'auditor'" },
          task: { type: "string", description: "Task description for cache tagging" },
        },
        required: ["content"],
      },
    },
    {
      name: "cache_alignment_stats",
      description: "Headroom CacheAligner — Get current cache alignment prefix and warmup status.",
      inputSchema: { type: "object", properties: {} },
    },

    // ─── Headroom: Learn (Self-Improving Failure Analysis) ─────────────
    {
      name: "analyze_failures",
      description:
        "Headroom Learn — Analyze recent failures and suggest corrections. Detects recurring error patterns and generates fix suggestions.",
      inputSchema: {
        type: "object",
        properties: {
          apply: {
            type: "boolean",
            description: "If true, automatically apply corrections as memory files (default: false)",
          },
        },
      },
    },
    {
      name: "learn_report",
      description: "Headroom Learn — Get learn report with failure stats, active patterns, and recent failures.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "log_failure",
      description: "Headroom Learn — Log a failure event for analysis. Used by StopFailure hooks.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["tool_failure", "stop_failure", "session_failure", "test_failure"],
            description: "Type of failure",
          },
          tool: { type: "string", description: "Tool name that failed" },
          error: { type: "string", description: "Error message" },
          context: { type: "string", description: "Additional context" },
        },
        required: ["type", "error"],
      },
    },
    {
      name: "resolve_failure",
      description: "Headroom Learn — Mark a failure as resolved.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Failure ID from learn_report" },
          resolution: { type: "string", description: "How the failure was resolved" },
        },
        required: ["id"],
      },
    },
    {
      name: "match_correction",
      description: "Headroom Learn — Find a correction that matches a given error string.",
      inputSchema: {
        type: "object",
        properties: {
          error: { type: "string", description: "Error message to match against known patterns" },
        },
        required: ["error"],
      },
    },

    // ─── Headroom: Cross-Agent Memory ──────────────────────────────────
    {
      name: "store_memory",
      description:
        "Cross-Agent Memory — Store a memory entry. Platform-agnostic; accessible by Claude, Codex, Gemini, Cursor. Auto-deduplicates by content hash.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Memory name/slug" },
          description: { type: "string", description: "One-line summary" },
          content: { type: "string", description: "Memory content body" },
          agentName: { type: "string", description: "Your agent identifier (e.g. 'alice', 'codex-session-1')" },
          platform: {
            type: "string",
            enum: ["claude", "codex", "gemini", "cursor", "other"],
            description: "Source platform (default: claude)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for categorization",
          },
          memoryType: {
            type: "string",
            enum: ["lesson", "decision", "fact", "reference", "feedback"],
            description: "Type of memory (default: lesson)",
          },
        },
        required: ["name", "description", "content", "agentName"],
      },
    },
    {
      name: "query_memory",
      description:
        "Cross-Agent Memory — Query memory entries across platforms. Supports filters by platform, agent, type, tags, and full-text search.",
      inputSchema: {
        type: "object",
        properties: {
          searchText: { type: "string", description: "Full-text search in name/description/content" },
          platforms: {
            type: "array",
            items: { type: "string", enum: ["claude", "codex", "gemini", "cursor", "other"] },
          },
          agentName: { type: "string", description: "Filter by agent name" },
          memoryType: {
            type: "string",
            enum: ["lesson", "decision", "fact", "reference", "feedback"],
          },
          tags: { type: "array", items: { type: "string" } },
          limit: { type: "number", description: "Max results" },
        },
      },
    },
    {
      name: "memory_stats",
      description:
        "Cross-Agent Memory — Get memory statistics: total entries, breakdown by platform/type, top tags, involved agents.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "export_memory_markdown",
      description:
        "Cross-Agent Memory — Export memory store as platform-agnostic Markdown. Other agents (Codex, Gemini, Cursor) can read this directly.",
      inputSchema: {
        type: "object",
        properties: {
          platforms: {
            type: "array",
            items: { type: "string", enum: ["claude", "codex", "gemini", "cursor", "other"] },
          },
          memoryType: {
            type: "string",
            enum: ["lesson", "decision", "fact", "reference", "feedback"],
          },
        },
      },
    },
    {
      name: "sync_memory_platform",
      description:
        "Cross-Agent Memory — Sync with another platform's memory directory. Imports entries from platform-specific subdirectory.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["claude", "codex", "gemini", "cursor", "other"],
            description: "Platform to sync from",
          },
        },
        required: ["platform"],
      },
    },
    {
      name: "supported_platforms",
      description: "Cross-Agent Memory — List all supported agent platforms for cross-agent memory sharing.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const root = cwd();
  const settings = loadSettings(root);
  const args = request.params.arguments as Record<string, unknown> | undefined;

  _toolCallCount++;
  _lastToolCallTime = Date.now();

  switch (request.params.name) {
    case "ping":
      return text({
        status: "ok",
        uptimeSeconds: Math.round((Date.now() - _serverStartTime) / 1000),
        toolCalls: _toolCallCount,
        lastToolCallSecondsAgo:
          _lastToolCallTime > 0
            ? Math.round((Date.now() - _lastToolCallTime) / 1000)
            : null,
        cache: {
          loaded: _cachedGraph !== null,
          nodes: _cachedGraph?.nodes.length ?? 0,
          edges: _cachedGraph?.edges.length ?? 0,
          mtime: _cachedGraphMtime ? new Date(_cachedGraphMtime).toISOString() : null,
        },
        lock: {
          writer: _graphLock.writer,
          readers: _graphLock.readers,
          pending: _graphLock.pending.length,
        },
      });
    case "scan_codebase":
    case "update_codebase": {
      await acquireWrite(_graphLock);
      try {
        const graph = await withTimeout(
          scanCodebase(root, settings),
          SCAN_TIMEOUT_MS,
          request.params.name,
        );
        await writeGraph(root, graph);
        // Invalidate cache after write so next read gets fresh data
        _cachedGraph = null;
        _cachedGraphMtime = 0;
        return text({
          graph: ".codegraph/graph.db",
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          filesScanned: graph.metadata.filesScanned,
        });
      } finally {
        releaseWrite(_graphLock);
      }
    }
    case "query_graph": {
      const query = stringArg(args?.query, "query");
      return text(queryGraph(await getCachedGraph(root), query, numberArg(args?.maxResults)));
    }
    case "search_code": {
      const pattern = stringArg(args?.pattern, "pattern");
      const isExplicitlyRegex = args?.regex === true;
      const caseSensitive = args?.caseSensitive === true;
      const contextLines = numberArg(args?.contextLines);
      const maxResults = numberArg(args?.maxResults);
      const maxFileSizeBytes = numberArg(args?.maxFileSizeBytes);
      const include = stringArrayArg(args?.include, "include");
      const exclude = stringArrayArg(args?.exclude, "exclude");

      let result = searchCodebase(root, settings, {
        pattern,
        regex: isExplicitlyRegex,
        caseSensitive,
        contextLines,
        maxResults,
        maxFileSizeBytes,
        include,
        exclude,
      });

      // Auto-fallback: if literal search yields 0 results and pattern contains regex syntax, try regex
      if (
        !isExplicitlyRegex &&
        result.stats.totalMatches === 0 &&
        /[|()[\]*+?^$]/.test(pattern)
      ) {
        try {
          const regexResult = searchCodebase(root, settings, {
            pattern,
            regex: true,
            caseSensitive,
            contextLines,
            maxResults,
            maxFileSizeBytes,
            include,
            exclude,
          });
          if (regexResult.stats.totalMatches > 0) {
            result = regexResult;
          }
        } catch (e) {
          // If the pattern was an invalid regex, ignore fallback and return the 0-result literal search
        }
      }

      return text(result);
    }
    case "export_graph":
      return text({
        written: exportGraph(
          root,
          await getCachedGraph(root),
          (args?.formats as string[] | undefined) ?? settings.exports,
        ),
      });
    case "analyze_impact": {
      const target = stringArg(args?.target, "target");
      const directionStr = typeof args?.direction === "string" ? args.direction : "both";
      const direction = ["upstream", "downstream", "both"].includes(directionStr)
        ? (directionStr as "upstream" | "downstream" | "both")
        : "both";
      return text(
        analyzeImpact(await getCachedGraph(root), target, Number.MAX_SAFE_INTEGER, direction),
      );
    }
    case "open_graph_ui":
      return text({ url: await openGraphUi(root, settings) });
    case "find_cycles":
      return text(findCycles(await getCachedGraph(root)));
    case "find_orphans":
      return text(findOrphans(await getCachedGraph(root)));
    case "summarize_architecture":
      return text(summarizeArchitecture(await getCachedGraph(root)));
    case "analyze_quality": {
      const report = analyzeGraphQuality(await getCachedGraph(root), root);
      const threshold = readThreshold(args?.failOn);
      if (!threshold) return text(report);
      const gate = evaluateQualityGate(report.issues, threshold);
      return text({
        ...report,
        ...gate,
        failingIssues: failingIssuesForThreshold(report, threshold),
      });
    }
    case "quality_gate": {
      const threshold = readThreshold(args?.threshold);
      if (!threshold) throw new Error("Invalid threshold. Use high, medium, or low.");
      const report = analyzeGraphQuality(await getCachedGraph(root), root);
      const gate = evaluateQualityGate(report.issues, threshold);
      const result = { ...gate, failingIssues: failingIssuesForThreshold(report, threshold) };
      if (args?.includeReport === true) return text({ ...report, ...result });
      return text(result);
    }
    case "list_directory_tree":
      return text(
        getDirectoryTree(root, String(args?.path ?? "."), { maxDepth: Number.MAX_SAFE_INTEGER }),
      );
    case "summarize_graph": {
      const summary = summarizeGraphForBudget(await getCachedGraph(root), {
        maxNodes: numberArg(args?.maxNodes) ?? 50,
        maxEdges: numberArg(args?.maxEdges) ?? 100,
      });
      const freshness = await getGraphFreshness(root);
      return text({ ...summary, freshness });
    }
    case "diff_graphs": {
      const before = JSON.parse(readFileSync(stringArg(args?.beforePath, "beforePath"), "utf8"));
      const after = JSON.parse(readFileSync(stringArg(args?.afterPath, "afterPath"), "utf8"));
      return text({ diff: formatGraphDiff(diffGraphs(before, after)) });
    }
    case "check_graph_freshness":
      return text(await getGraphFreshness(root));

    // ─── Headroom: CCR Compression Handlers ────────────────────────────
    case "compress_content": {
      const content = stringArg(args?.content, "content");
      const result = compress(content, {
        contentType: (args?.contentType as "auto" | "json" | "code" | "prose") ?? "auto",
        filePath: args?.filePath as string | undefined,
      });
      return text(result);
    }
    case "decompress_content": {
      const ccrId = stringArg(args?.ccrId, "ccrId");
      const result = decompress(ccrId);
      if (!result) throw new Error(`CCR ID not found: ${ccrId}`);
      return text(result);
    }
    case "ccr_stats":
      return text(getCompressionStats());
    case "clean_ccr": {
      const maxAge = Number(args?.maxAgeHours) || 24;
      return text({ purged: cleanCCR(maxAge) });
    }

    // ─── Headroom: CacheAligner Handlers ───────────────────────────────
    case "align_cache": {
      const rawContent = stringArg(args?.content, "content");
      const result = alignCache(rawContent, {
        taskType: args?.type as string | undefined,
        mode: args?.subType as string | undefined,
        projectName: args?.task as string | undefined,
      });
      return text(result);
    }
    case "cache_alignment_stats":
      return text(getCacheAlignment());

    // ─── Headroom: Learn Handlers ──────────────────────────────────────
    case "analyze_failures": {
      const analysis = analyzeFailures();
      const shouldApply = args?.apply === true;
      if (shouldApply && analysis.suggestions.length > 0) {
        const applied = applyCorrections(analysis.suggestions);
        return text({ ...analysis, applied: applied.written, memoryFiles: applied.memoryFiles });
      }
      return text(analysis);
    }
    case "learn_report":
      return text(getLearnReport());
    case "log_failure": {
      const record = logFailure({
        type: stringArg(args?.type, "type") as "tool_failure" | "stop_failure" | "session_failure" | "test_failure",
        tool: args?.tool as string | undefined,
        error: stringArg(args?.error, "error"),
        context: args?.context as string | undefined,
      });
      return text(record);
    }
    case "resolve_failure": {
      const id = stringArg(args?.id, "id");
      const success = resolveFailure(id, args?.resolution as string | undefined);
      return text({ resolved: success, id });
    }
    case "match_correction": {
      const err = stringArg(args?.error, "error");
      const match = matchCorrection(err);
      return text({ matched: match !== undefined, correction: match ?? null });
    }

    // ─── Headroom: Cross-Agent Memory Handlers ─────────────────────────
    case "store_memory": {
      const entry = storeMemory({
        name: stringArg(args?.name, "name"),
        description: stringArg(args?.description, "description"),
        content: stringArg(args?.content, "content"),
        agentName: stringArg(args?.agentName, "agentName"),
        platform: (args?.platform as "claude" | "codex" | "gemini" | "cursor" | "other") ?? "claude",
        tags: (args?.tags as string[]) ?? [],
        memoryType: (args?.memoryType as "lesson" | "decision" | "fact" | "reference" | "feedback") ?? "lesson",
      });
      return text(entry);
    }
    case "query_memory": {
      const results = queryMemory({
        searchText: args?.searchText as string | undefined,
        platforms: args?.platforms as string[] | undefined,
        agentName: args?.agentName as string | undefined,
        memoryType: args?.memoryType as string | undefined,
        tags: args?.tags as string[] | undefined,
        limit: Number(args?.limit) || undefined,
      });
      return text({ results, count: results.length });
    }
    case "memory_stats":
      return text(getMemoryStats());
    case "export_memory_markdown": {
      const md = exportMemoryToMarkdown({
        platforms: args?.platforms as string[] | undefined,
        memoryType: args?.memoryType as string | undefined,
      });
      return text({ markdown: md });
    }
    case "sync_memory_platform": {
      const platform = stringArg(args?.platform, "platform") as "claude" | "codex" | "gemini" | "cursor" | "other";
      const result = syncWithPlatform(platform);
      return text(result);
    }
    case "supported_platforms":
      return text({ platforms: getSupportedPlatforms() });

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

await server.connect(new StdioServerTransport());

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function numberArg(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Search numeric options must be finite numbers.");
}

function stringArg(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${name} must be a non-empty string.`);
}

function stringArrayArg(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new Error(`${name} must be an array of strings.`);
}

interface GraphFreshness {
  exists: boolean;
  ageMinutes: number;
  isStale: boolean;
  recommendation: string;
}

async function getGraphFreshness(root: string): Promise<GraphFreshness> {
  const dbPath = join(root, ".codegraph", "graph.db");
  if (!(await graphExists(root))) {
    return {
      exists: false,
      ageMinutes: -1,
      isStale: true,
      recommendation: "No graph database found. Run scan_codebase before deep analysis.",
    };
  }
  const mtimeMs = statSync(dbPath).mtimeMs;
  const ageMinutes = Math.round((Date.now() - mtimeMs) / 60_000);
  const isStale = ageMinutes > 120;
  return {
    exists: true,
    ageMinutes,
    isStale,
    recommendation: isStale
      ? `Graph is ${ageMinutes}m old — stale. Run scan_codebase before deep analysis or architecture audits.`
      : `Graph is fresh (${ageMinutes}m old). Safe to use for analysis.`,
  };
}
