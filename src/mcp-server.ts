#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
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
import { numberArg, stringArg, stringArrayArg } from "./args.js";
import { exportGraph } from "./exporters.js";
import { getDirectoryTree } from "./fs-tools.js";
import { diffGraphs, formatGraphDiff } from "./git-diff.js";
import { summarizeGraphForBudget } from "./graph/summarize.js";
import { graphExists, readGraph, scanCodebase, writeGraph } from "./graph.js";
import { getThinkingEngine } from "./mcp-handlers/sequential-thinking.js";
import type { ToolHandlerContext } from "./mcp-router.js";
import { McpDelegationRouter, router } from "./mcp-router.js";
import { searchCodebase } from "./search.js";
import { SequentialThinkingEngine } from "./sequential-thinking.js";
import { loadSettings } from "./settings.js";
import type { CodeGraph } from "./types.js";
import { openGraphUi } from "./ui.js";

/**
 * Get mtime of the JSON graph file.
 * Returns 0 if file does not exist.
 */
function getGraphJsonMtime(root: string): number {
  const dbPath = join(root, ".codegraph", "graph.json");
  try {
    return statSync(dbPath).mtimeMs;
  } catch {
    return 0;
  }
}

class GraphCacheService {
  private cachedGraph: CodeGraph | null = null;
  private cachedGraphMtime = 0;
  private isReading = false;
  private readQueue: Array<() => void> = [];

  private async acquireLock(): Promise<void> {
    if (!this.isReading) {
      this.isReading = true;
      return;
    }
    return new Promise((resolve) => this.readQueue.push(resolve));
  }

  private releaseLock() {
    if (this.readQueue.length > 0) {
      const next = this.readQueue.shift()!;
      next();
    } else {
      this.isReading = false;
    }
  }

  public get isLoaded(): boolean {
    return this.cachedGraph !== null;
  }

  public get nodesCount(): number {
    return this.cachedGraph?.nodes.length ?? 0;
  }

  public get edgesCount(): number {
    return this.cachedGraph?.edges.length ?? 0;
  }

  public get mtime(): number {
    return this.cachedGraphMtime;
  }

  async getGraph(root: string): Promise<CodeGraph> {
    const mtime = getGraphJsonMtime(root);
    if (this.cachedGraph && this.cachedGraphMtime === mtime) {
      return this.cachedGraph;
    }

    await this.acquireLock();
    try {
      // Check again after acquiring lock
      const currentMtime = getGraphJsonMtime(root);
      if (this.cachedGraph && this.cachedGraphMtime === currentMtime) {
        return this.cachedGraph;
      }

      this.cachedGraph = await readGraph(root);
      this.cachedGraphMtime = currentMtime;
      return this.cachedGraph;
    } finally {
      this.releaseLock();
    }
  }

  invalidate() {
    this.cachedGraph = null;
    this.cachedGraphMtime = 0;
  }
}

const graphCache = new GraphCacheService();

// ─── McpDelegationRouter bridge ────────────────────────────────────────
// Register delegation handlers. Existing switch-case tools can migrate to
// this pattern incrementally. New tools should prefer router.register().
const routerCtx = (): ToolHandlerContext => ({
  root: cwd(),
  settings: loadSettings(cwd()),
  serverStartTime: _serverStartTime,
  toolCallCount: _toolCallCount,
  lastToolCallTime: _lastToolCallTime,
  graphCache,
});
router.register("ping", async (_args, ctx) => ({
  status: "ok",
  uptimeSeconds: Math.round((Date.now() - ctx.serverStartTime) / 1000),
  toolCalls: ctx.toolCallCount,
  cache: {
    loaded: graphCache.isLoaded,
    nodes: graphCache.nodesCount,
    edges: graphCache.edgesCount,
  },
}));

const server = new Server(
  { name: "codegraph-mapper", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

import {
  createADR,
  formatADRList,
  generateADRGraph,
  getADR,
  initADR,
  listADRs,
  updateADRStatus,
} from "./adr.js";
import { compareOpenApiSpecs, diffOpenApiFromGit, formatContractReport } from "./api-contract.js";
import { answerQuestion, formatQAResult, generateOnboardingDocs } from "./codebase-qa.js";
import { compareStats, formatStats, generateStats, getStatsHistory } from "./codebase-stats.js";
import {
  analyzeDirectory,
  formatComplexityReport,
  trackComplexityTrend,
} from "./complexity-tracker.js";
// ─── Server uptime tracking (for health checks) ───
import {
  alignCache,
  cleanCCR,
  compress,
  decompress,
  getCacheAlignment,
  getStats as getCompressionStats,
} from "./compress.js";
import {
  detectMissingEnvVars,
  formatValidationReport,
  validateEnvFile,
  validateJsonFile,
} from "./config-validator.js";
import {
  aggregateCoverage,
  checkCoverageThreshold,
  formatCoverageReport,
} from "./coverage-aggregator.js";
import {
  exportToMarkdown as exportMemoryToMarkdown,
  getMemoryStats,
  getSupportedPlatforms,
  queryMemory,
  storeMemory,
  syncWithPlatform,
} from "./cross-agent-memory.js";
import {
  compareSchemas,
  formatSchemaDiff,
  formatSchemaReport,
  parsePrismaSchema,
} from "./db-schema.js";
import { detectDeadCodeFromGraph } from "./deadcode.js";
import { formatDoctorReport, generateDoctorReport } from "./doctor.js";
import { scaffoldHooks, validateCommitMessage } from "./git-hooks.js";
import {
  checkMissingTranslation,
  extractHardcodedStrings,
  formatLocaleReport,
} from "./i18n-helper.js";
import {
  analyzeFailures,
  applyCorrections,
  getLearnReport,
  logFailure,
  matchCorrection,
  resolveFailure,
} from "./learn.js";
import { categorizeLicenses, formatLicenseReport, scanNpmLicenses } from "./license-checker.js";
import { analyzeLogFile, formatLogReport } from "./log-analyzer.js";
import {
  analyzeBundleStats,
  compareBundles,
  createPerfReport,
  formatBundleReport,
  parseBundlePhobia,
} from "./performance-audit.js";
import {
  createRelease,
  formatChangelogMarkdown,
  generateChangelog,
  generatePRDescription,
} from "./release.js";
import { formatSecretsReport, scanForSecrets } from "./secrets.js";
import { buildEmbeddings, getEmbeddingStats, semanticSearch } from "./semantic-search.js";
import { readSwarmMessages, sendSwarmMessage } from "./swarm-chat.js";
import {
  checkPRAutoMerge,
  detectBenchmarkRegression,
  generateSprintReport,
  getBenchmarkHistory,
  getTeamMetrics,
  recordBenchmark,
} from "./tier3.js";
import { formatTodoReport, getTodoHistory, scanForTodos } from "./todo-tracker.js";
import { formatVulnReport, generateSBOM, scanVulnerabilities } from "./vuln-sbom.js";

const _serverStartTime = Date.now();
let _toolCallCount = 0;
let _lastToolCallTime = 0;

// ─── Tool timeout (prevents stalled scan requests from blocking the server) ───
const SCAN_TIMEOUT_MS = 5 * 60_000; // 5 minutes for full scan

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  toolName: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Tool "${toolName}" timed out after ${ms}ms`));
  }, ms);

  try {
    return await operation(controller.signal);
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
      description:
        "Update the graph database for only the files that have changed since the last scan.",
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
        "Search source text across project files. IMPORTANT: By default, this is a regex search. For literal strings, set 'regex': false.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The regex pattern or literal string to search for (primary).",
          },
          patterns: {
            type: "array",
            items: { type: "string" },
            description:
              "Additional patterns to search for (OR'd with pattern). Results are deduplicated.",
          },
          regex: {
            type: "boolean",
            description: "Set to false for literal string search. Default is true (regex).",
          },
          caseSensitive: { type: "boolean", description: "Default is false (case-insensitive)." },
          contextLines: {
            type: "number",
            description: "Number of context lines before and after match.",
          },
          maxResults: { type: "number", description: "Maximum number of results to return." },
          maxFileSizeBytes: { type: "number" },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to include",
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to exclude",
          },
          path: {
            type: "string",
            description: "Optional directory/file path to scope the search",
          },
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
      description: "Detect circular dependencies in the module graph.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Max cycles to return (default: 50). Set higher for full report.",
          },
        },
      },
    },
    {
      name: "find_orphans",
      description: "Identify orphan files/symbols — files with no incoming references.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: { type: "number", description: "Max orphans to return (default: 50)." },
        },
      },
    },
    {
      name: "summarize_architecture",
      description:
        "Graph‑backed architecture: entry points, modules, dependencies, hotspots. WARNING: can return large data — use maxNodes/maxEdges to limit.",
      inputSchema: {
        type: "object",
        properties: {
          maxNodes: {
            type: "number",
            description: "Max nodes to return (default: all). Set to 100-200 for overview.",
          },
          maxEdges: { type: "number", description: "Max edges to return (default: all)." },
        },
      },
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
      description:
        "Health check — returns server uptime, cache status, and connection state. Use to verify the MCP server is responsive before initiating long-running operations.",
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
          filePath: {
            type: "string",
            description: "File path for code compression (enables AST-aware)",
          },
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
      description:
        "Headroom CCR — Get compression statistics: total compressed entries, breakdown by type, storage usage.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "clean_ccr",
      description:
        "Headroom CCR — Purge expired compressed content older than maxAgeHours (default: 24h).",
      inputSchema: {
        type: "object",
        properties: {
          maxAgeHours: {
            type: "number",
            description: "Max age in hours before purging (default: 24)",
          },
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
          subType: {
            type: "string",
            description: "Specific agent/skill name e.g. 'implementer', 'auditor'",
          },
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
            description:
              "If true, automatically apply corrections as memory files (default: false)",
          },
        },
      },
    },
    {
      name: "learn_report",
      description:
        "Headroom Learn — Get learn report with failure stats, active patterns, and recent failures.",
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

    // ─── Swarm Chat (Inter-Agent Communication) ────────────────────────
    {
      name: "send_swarm_message",
      description:
        "Swarm Chat — Send a message to another parallel subagent or broadcast to 'all'. Use this to coordinate, resolve file conflicts, or share discoveries.",
      inputSchema: {
        type: "object",
        properties: {
          sender: { type: "string", description: "Your agent name/role" },
          recipient: { type: "string", description: "Target agent name/role, or 'all'" },
          content: { type: "string", description: "The message content" },
        },
        required: ["sender", "recipient", "content"],
      },
    },
    {
      name: "read_swarm_messages",
      description: "Swarm Chat — Read messages sent to you or broadcasted to 'all'.",
      inputSchema: {
        type: "object",
        properties: {
          recipientFilter: {
            type: "string",
            description: "Your agent name/role to filter messages for you. Leave empty to see all.",
          },
          sinceTimestamp: {
            type: "string",
            description: "ISO 8601 timestamp to only get new messages since this time",
          },
        },
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
          agentName: {
            type: "string",
            description: "Your agent identifier (e.g. 'alice', 'codex-session-1')",
          },
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
          searchText: {
            type: "string",
            description: "Full-text search in name/description/content",
          },
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
      description:
        "Cross-Agent Memory — List all supported agent platforms for cross-agent memory sharing.",
      inputSchema: { type: "object", properties: {} },
    },

    // ─── Dead Code Detector ────────────────────────────────────────────
    {
      name: "find_dead_code",
      description:
        "Detect unused exports, orphan files, and uncalled functions using graph edge analysis.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Max dead code items to return (default: 50).",
          },
        },
      },
    },

    // ─── Semantic Code Search ──────────────────────────────────────────
    {
      name: "semantic_search",
      description:
        "Semantic code search by meaning (not just regex). Uses embedding similarity + lexical fallback.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query in natural language" },
          maxResults: { type: "number", description: "Max results (default: 20)" },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to include",
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to exclude",
          },
          threshold: { type: "number", description: "Similarity threshold 0-1 (default: 0.25)" },
        },
        required: ["query"],
      },
    },
    {
      name: "build_embeddings",
      description:
        "Build embedding cache for semantic search. Scans source files and generates hash embeddings.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "embedding_stats",
      description: "Get embedding cache statistics: files, chunks, storage bytes.",
      inputSchema: { type: "object", properties: {} },
    },

    // ─── PR & Changelog Generator ──────────────────────────────────────
    {
      name: "generate_pr",
      description: "Auto-generate a PR description from git diff and conventional commits.",
      inputSchema: {
        type: "object",
        properties: {
          targetBranch: { type: "string", description: "Base branch (default: main)" },
          includeSummary: { type: "boolean", description: "Include summary section" },
          includeChecklist: { type: "boolean", description: "Include checklist section" },
        },
      },
    },
    {
      name: "generate_changelog",
      description: "Generate changelog from git tags and conventional commits.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Starting version tag" },
          to: { type: "string", description: "Ending version tag" },
        },
      },
    },
    {
      name: "create_release",
      description: "Bump version, generate changelog, prepare tag. Options: patch, minor, major.",
      inputSchema: {
        type: "object",
        properties: {
          bump: {
            type: "string",
            enum: ["patch", "minor", "major"],
            description: "Version bump level",
          },
        },
        required: ["bump"],
      },
    },

    // ─── Secrets Scanner ───────────────────────────────────────────────
    {
      name: "scan_secrets",
      description:
        "Scan repository for hardcoded secrets: API keys, tokens, passwords, private keys.",
      inputSchema: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Paths to scan (default: root)",
          },
          severity: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Minimum severity to report",
          },
        },
      },
    },

    // ─── ADR Manager ───────────────────────────────────────────────────
    {
      name: "adr_init",
      description: "Initialize ADR directory with README.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "adr_new",
      description: "Create a new Architecture Decision Record.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Decision title" },
          status: { type: "string", enum: ["proposed", "accepted", "deprecated", "superseded"] },
          supersedes: { type: "number", description: "ADR ID that this supersedes" },
        },
        required: ["title"],
      },
    },
    {
      name: "adr_list",
      description: "List all Architecture Decision Records.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "adr_get",
      description: "Get a specific ADR by ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number", description: "ADR ID" } },
        required: ["id"],
      },
    },
    {
      name: "adr_status",
      description: "Update ADR status (proposed/accepted/deprecated/superseded).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "ADR ID" },
          status: { type: "string", enum: ["proposed", "accepted", "deprecated", "superseded"] },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "adr_graph",
      description: "Generate Mermaid graph of ADR relationships.",
      inputSchema: { type: "object", properties: {} },
    },

    // ─── Vulnerability Scanner & SBOM ──────────────────────────────────
    {
      name: "scan_vulnerabilities",
      description: "Scan dependencies for known CVEs. Supports npm, pip, go, cargo.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "generate_sbom",
      description: "Generate Software Bill of Materials (SPDX 2.3 or CycloneDX 1.5).",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["spdx", "cyclonedx"], description: "SBOM format" },
        },
      },
    },

    // ─── Codebase Q&A ──────────────────────────────────────────────────
    {
      name: "answer_question",
      description:
        "Answer questions about the codebase by searching docs, code definitions, and CodeGraph.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "Your question about the codebase" },
          maxSources: { type: "number", description: "Max sources to return" },
          includeFiles: {
            type: "array",
            items: { type: "string" },
            description: "Specific files to search",
          },
        },
        required: ["question"],
      },
    },
    {
      name: "generate_onboarding_docs",
      description: "Auto-generate CONTRIBUTING.md and ARCHITECTURE.md from CodeGraph data.",
      inputSchema: { type: "object", properties: {} },
    },

    // ─── Tier 3: Sprint / Team / Auto-Merge / Benchmark ────────────────
    {
      name: "sprint_report",
      description: "Generate sprint report from git history. Default: last 7 days.",
      inputSchema: {
        type: "object",
        properties: {
          since: {
            type: "string",
            description: "Git time range (e.g. '7.days.ago', '2024-01-01')",
          },
        },
      },
    },
    {
      name: "team_metrics",
      description: "Quick team dashboard: open PRs, stale branches, unreviewed PRs, sprint stats.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "pr_auto_merge",
      description:
        "Check if a PR meets auto-merge conditions (checks pass, approved, no conflicts).",
      inputSchema: {
        type: "object",
        properties: { prNumber: { type: "number", description: "PR number" } },
        required: ["prNumber"],
      },
    },
    {
      name: "record_benchmark",
      description: "Record a benchmark result for regression tracking.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Benchmark name" },
          duration: { type: "number", description: "Duration in ms" },
        },
        required: ["name", "duration"],
      },
    },
    {
      name: "benchmark_history",
      description: "Get benchmark history with durations and timestamps.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Benchmark name" },
          limit: { type: "number", description: "Max entries (default: 20)" },
        },
        required: ["name"],
      },
    },
    {
      name: "benchmark_regression",
      description: "Detect benchmark regression (>10% slowdown vs historical average).",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Benchmark name" } },
        required: ["name"],
      },
    },

    // ─── API Contract Tester ────────────────────────────────────────────
    {
      name: "compare_api_specs",
      description: "Compare two OpenAPI specs and detect breaking changes.",
      inputSchema: {
        type: "object",
        properties: {
          beforePath: { type: "string", description: "Path to original OpenAPI spec" },
          afterPath: { type: "string", description: "Path to updated OpenAPI spec" },
        },
        required: ["beforePath", "afterPath"],
      },
    },
    {
      name: "diff_api_from_git",
      description: "Compare OpenAPI specs across git refs to detect API drift.",
      inputSchema: {
        type: "object",
        properties: {
          ref1: { type: "string", description: "First git ref (default: HEAD)" },
          ref2: { type: "string", description: "Second git ref" },
        },
      },
    },

    // ─── Config Validator ───────────────────────────────────────────────
    {
      name: "validate_env_file",
      description: "Validate .env file against a JSON schema.",
      inputSchema: {
        type: "object",
        properties: {
          envPath: { type: "string", description: "Path to .env file" },
          schema: { type: "object", description: "JSON schema with key→{type,required} mapping" },
        },
        required: ["envPath", "schema"],
      },
    },
    {
      name: "validate_json_file",
      description: "Validate a JSON file against a schema.",
      inputSchema: {
        type: "object",
        properties: {
          jsonPath: { type: "string", description: "Path to JSON file" },
          schema: { type: "object", description: "Validation schema" },
        },
        required: ["jsonPath", "schema"],
      },
    },
    {
      name: "detect_missing_env_vars",
      description: "Check if required environment variables are present in .env file.",
      inputSchema: {
        type: "object",
        properties: {
          requiredVars: {
            type: "array",
            items: { type: "string" },
            description: "Required variable names",
          },
          envPath: { type: "string", description: "Path to .env file" },
        },
        required: ["requiredVars"],
      },
    },

    // ─── License Checker ────────────────────────────────────────────────
    {
      name: "check_licenses",
      description: "Scan npm dependencies and report license compatibility issues.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Project root directory" },
        },
      },
    },

    // ─── Complexity Tracker ─────────────────────────────────────────────
    {
      name: "analyze_complexity",
      description: "Measure cyclomatic complexity across the codebase.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Project root directory" },
          glob: { type: "string", description: "File glob pattern (default: **/*.ts)" },
        },
      },
    },
    {
      name: "track_complexity_trend",
      description: "Track complexity changes between current and previous scan.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Project root directory" },
        },
      },
    },

    // ─── Log Analyzer ───────────────────────────────────────────────────
    {
      name: "analyze_logs",
      description: "Parse structured logs (JSONL) and produce error analysis report.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path to log file" },
        },
        required: ["filePath"],
      },
    },

    // ─── Coverage Aggregator ────────────────────────────────────────────
    {
      name: "aggregate_coverage",
      description: "Merge coverage reports from jest, vitest, istanbul into unified report.",
      inputSchema: {
        type: "object",
        properties: {
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", enum: ["jest", "vitest", "playwright", "istanbul", "nyc"] },
                path: { type: "string" },
              },
            },
          },
        },
        required: ["sources"],
      },
    },
    {
      name: "check_coverage_threshold",
      description: "Check if coverage meets minimum threshold across all files.",
      inputSchema: {
        type: "object",
        properties: {
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", enum: ["jest", "vitest", "playwright", "istanbul", "nyc"] },
                path: { type: "string" },
              },
            },
          },
          threshold: { type: "number", description: "Minimum coverage percentage" },
        },
        required: ["sources", "threshold"],
      },
    },

    // ─── Git Hook Scaffolder ────────────────────────────────────────────
    {
      name: "scaffold_git_hooks",
      description: "Generate git hooks with lint, conventional commit validation, and test checks.",
      inputSchema: {
        type: "object",
        properties: {
          targetDir: { type: "string", description: "Project directory with .git" },
          hooks: {
            type: "array",
            items: {
              type: "string",
              enum: ["pre-commit", "commit-msg", "pre-push", "post-commit", "post-merge"],
            },
          },
          linter: { type: "string", description: "Linter command to run on pre-commit" },
          testCommand: { type: "string", description: "Test command for pre-push" },
        },
        required: ["targetDir", "hooks"],
      },
    },
    {
      name: "validate_commit_message",
      description: "Check a commit message against conventional commit format.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Commit message to validate" },
        },
        required: ["message"],
      },
    },

    // ─── Todo/Fixme Tracker ─────────────────────────────────────────────
    {
      name: "scan_todos",
      description:
        "Scan codebase for TODO/FIXME/HACK/NOTE/XXX/TEMP/WIP/TBD comments with author tracking.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Project root" },
          include: { type: "string", description: "Comma-separated include globs" },
          exclude: { type: "string", description: "Comma-separated exclude globs" },
        },
      },
    },
    {
      name: "todo_history",
      description: "Show historical TODO/FIXME tracking data.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } },
    },

    // ─── Performance Audit ──────────────────────────────────────────────
    {
      name: "analyze_bundle",
      description: "Analyze webpack/vite stats.json for bundle composition.",
      inputSchema: {
        type: "object",
        properties: {
          statsPath: { type: "string", description: "Path to stats.json" },
        },
      },
    },
    {
      name: "compare_bundles",
      description: "Compare two bundle analyses to detect size regressions.",
      inputSchema: {
        type: "object",
        properties: {
          beforeStats: { type: "string", description: "Path to previous stats.json" },
          afterStats: { type: "string", description: "Path to current stats.json" },
        },
        required: ["beforeStats", "afterStats"],
      },
    },
    {
      name: "generate_perf_report",
      description: "Generate combined performance report (bundle + lighthouse if available).",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string", description: "Project root" } },
      },
    },

    // ─── i18n Helper ────────────────────────────────────────────────────
    {
      name: "extract_i18n_strings",
      description: "Extract hardcoded user-facing strings from source code.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Project root" },
          excludePatterns: { type: "string", description: "Comma-separated exclude patterns" },
        },
      },
    },
    {
      name: "check_missing_translations",
      description: "Compare extracted strings against locale files to find missing translations.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Project root" },
          localesDir: { type: "string", description: "Locale directory path" },
        },
        required: ["root", "localesDir"],
      },
    },

    // ─── DB Schema Reporter ─────────────────────────────────────────────
    {
      name: "parse_prisma_schema",
      description: "Parse Prisma schema file into entity relationship report.",
      inputSchema: {
        type: "object",
        properties: { schemaPath: { type: "string", description: "Path to schema.prisma" } },
        required: ["schemaPath"],
      },
    },
    {
      name: "diff_db_schemas",
      description: "Compare two schema reports and generate migration summary.",
      inputSchema: {
        type: "object",
        properties: {
          beforeSchema: { type: "string", description: "Path to previous schema file" },
          afterSchema: { type: "string", description: "Path to current schema file" },
        },
        required: ["beforeSchema", "afterSchema"],
      },
    },

    // ─── Doctor (Environment) ───────────────────────────────────────────
    {
      name: "doctor",
      description: "Check development environment: tools, project health, and diagnose issues.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string", description: "Project root" } },
      },
    },

    // ─── Codebase Stats ─────────────────────────────────────────────────
    {
      name: "codebase_stats",
      description: "Generate snapshot of codebase statistics (LOC, languages, deps).",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string", description: "Project root" } },
      },
    },
    {
      name: "codebase_stats_history",
      description: "Show historical codebase stats trends over time.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" } },
      },
    },
    {
      name: "compare_codebase_stats",
      description: "Compare current stats with last snapshot to show change.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" } },
      },
    },

    // ─── Sequential Thinking ────────────────────────────────────────────────
    {
      name: "sequential_thinking",
      description: `A detailed tool for dynamic and reflective problem-solving through structured thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust total_thoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack
- Generates a solution hypothesis
- Verifies the hypothesis based on the Chain of Thought steps
- Repeats the process until satisfied
- Provides a correct answer`,
      inputSchema: {
        type: "object",
        properties: {
          thought: { type: "string", description: "Your current thinking step" },
          nextThoughtNeeded: {
            type: "boolean",
            description: "Whether another thought step is needed",
          },
          thoughtNumber: { type: "number", description: "Current thought number (1-based)" },
          totalThoughts: { type: "number", description: "Estimated total thoughts needed" },
          isRevision: { type: "boolean", description: "Whether this revises previous thinking" },
          revisesThought: { type: "number", description: "Which thought is being reconsidered" },
          branchFromThought: { type: "number", description: "Branching point thought number" },
          branchId: { type: "string", description: "Branch identifier" },
          needsMoreThoughts: { type: "boolean", description: "If more thoughts are needed" },
          sessionId: {
            type: "string",
            description: "Optional session ID to isolate thinking states per agent or task",
          },
        },
        required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"],
      },
    },
    {
      name: "sequential_thinking_export",
      description: "Export the current sequential thinking session as Markdown.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Optional session ID to load. Defaults to current session.",
          },
          format: {
            type: "string",
            enum: ["markdown", "tree", "mermaid", "summary"],
            description: "Export format",
          },
        },
      },
    },
    {
      name: "sequential_thinking_list",
      description: "List all persisted sequential thinking sessions.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "sequential_thinking_reset",
      description: "Reset (clear) the current sequential thinking session.",
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
          _lastToolCallTime > 0 ? Math.round((Date.now() - _lastToolCallTime) / 1000) : null,
        cache: {
          loaded: graphCache.isLoaded,
          nodes: graphCache.nodesCount,
          edges: graphCache.edgesCount,
          mtime: graphCache.mtime ? new Date(graphCache.mtime).toISOString() : null,
        },
      });
    case "scan_codebase":
    case "update_codebase": {
      const graph = await withTimeout(
        (signal) => scanCodebase(root, settings, signal),
        SCAN_TIMEOUT_MS,
        request.params.name,
      );
      await writeGraph(root, graph);
      // Invalidate cache after write so next read gets fresh data
      graphCache.invalidate();
      return text({
        graph: ".codegraph/graph.json",
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        filesScanned: graph.metadata.filesScanned,
      });
    }
    case "query_graph": {
      const query = stringArg(args?.query, "query");
      return text(queryGraph(await graphCache.getGraph(root), query, numberArg(args?.maxResults)));
    }
    case "search_code": {
      const pattern = stringArg(args?.pattern, "pattern");
      const patterns = stringArrayArg(args?.patterns, "patterns");
      // Default: regex=true. Only set regex:false for literal search.
      const regex = args?.regex !== false;
      const caseSensitive = args?.caseSensitive === true;
      const contextLines = numberArg(args?.contextLines);
      const maxResults = numberArg(args?.maxResults);
      const maxFileSizeBytes = numberArg(args?.maxFileSizeBytes);
      const include = stringArrayArg(args?.include, "include");
      const exclude = stringArrayArg(args?.exclude, "exclude");
      const path = args?.path as string | undefined;

      const result = searchCodebase(root, settings, {
        pattern,
        patterns,
        regex,
        caseSensitive,
        contextLines,
        maxResults,
        maxFileSizeBytes,
        include,
        exclude,
        path,
      });

      return text(result);
    }
    case "export_graph":
      return text({
        written: exportGraph(
          root,
          await graphCache.getGraph(root),
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
        analyzeImpact(await graphCache.getGraph(root), target, Number.MAX_SAFE_INTEGER, direction),
      );
    }
    case "open_graph_ui":
      return text({ url: await openGraphUi(root, settings) });
    case "find_cycles":
      return text(findCycles(await graphCache.getGraph(root)));
    case "find_orphans":
      return text(findOrphans(await graphCache.getGraph(root)));
    case "summarize_architecture": {
      const graph = await graphCache.getGraph(root);
      const maxNodes = numberArg(args?.maxNodes) ?? graph.nodes.length;
      const maxEdges = numberArg(args?.maxEdges) ?? graph.edges.length;
      const summary = summarizeGraphForBudget(graph, { maxNodes, maxEdges });
      const freshness = await getGraphFreshness(root);
      return text({ ...summary, freshness });
    }
    case "analyze_quality": {
      const report = analyzeGraphQuality(await graphCache.getGraph(root), root);
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
      const report = analyzeGraphQuality(await graphCache.getGraph(root), root);
      const gate = evaluateQualityGate(report.issues, threshold);
      const result = { ...gate, failingIssues: failingIssuesForThreshold(report, threshold) };
      if (args?.includeReport === true) return text({ ...report, ...result });
      return text(result);
    }
    case "list_directory_tree":
      return text(
        getDirectoryTree(root, String(args?.path ?? "."), {
          maxDepth: typeof args?.maxDepth === "number" ? args.maxDepth : Number.MAX_SAFE_INTEGER,
        }),
      );
    case "summarize_graph": {
      const summary = summarizeGraphForBudget(await graphCache.getGraph(root), {
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
        type: stringArg(args?.type, "type") as
          | "tool_failure"
          | "stop_failure"
          | "session_failure"
          | "test_failure",
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

    // ─── Swarm Chat Handlers ───────────────────────────────────────────
    case "send_swarm_message": {
      const msg = sendSwarmMessage(
        root,
        stringArg(args?.sender, "sender"),
        stringArg(args?.recipient, "recipient"),
        stringArg(args?.content, "content"),
      );
      return text({ success: true, message: msg });
    }

    case "read_swarm_messages": {
      const messages = readSwarmMessages(
        root,
        args?.recipientFilter ? String(args.recipientFilter) : undefined,
        args?.sinceTimestamp ? String(args.sinceTimestamp) : undefined,
      );
      return text({ messages });
    }

    // ─── Headroom: Cross-Agent Memory Handlers ─────────────────────────
    case "store_memory": {
      const entry = storeMemory({
        name: stringArg(args?.name, "name"),
        description: stringArg(args?.description, "description"),
        content: stringArg(args?.content, "content"),
        agentName: stringArg(args?.agentName, "agentName"),
        platform:
          (args?.platform as "claude" | "codex" | "gemini" | "cursor" | "other") ?? "claude",
        tags: (args?.tags as string[]) ?? [],
        memoryType:
          (args?.memoryType as "lesson" | "decision" | "fact" | "reference" | "feedback") ??
          "lesson",
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
      const platform = stringArg(args?.platform, "platform") as
        | "claude"
        | "codex"
        | "gemini"
        | "cursor"
        | "other";
      const result = syncWithPlatform(platform);
      return text(result);
    }
    case "supported_platforms":
      return text({ platforms: getSupportedPlatforms() });

    // ─── Dead Code Detector ────────────────────────────────────────────
    case "find_dead_code": {
      const result = await detectDeadCodeFromGraph(root);
      return text(result);
    }

    // ─── Semantic Code Search ──────────────────────────────────────────
    case "semantic_search": {
      const result = semanticSearch(root, settings, {
        query: stringArg(args?.query, "query"),
        maxResults: numberArg(args?.maxResults),
        include: stringArrayArg(args?.include, "include"),
        exclude: stringArrayArg(args?.exclude, "exclude"),
        threshold: args?.threshold as number | undefined,
      });
      return text(result);
    }
    case "build_embeddings": {
      const result = buildEmbeddings(root, settings);
      return text(result);
    }
    case "embedding_stats":
      return text(getEmbeddingStats(root));

    // ─── PR & Changelog Generator ──────────────────────────────────────
    case "generate_pr": {
      const pr = generatePRDescription({
        targetBranch: args?.targetBranch as string | undefined,
        includeSummary: args?.includeSummary !== false,
        includeChecklist: args?.includeChecklist !== false,
      });
      return text(pr);
    }
    case "generate_changelog": {
      const entries = generateChangelog(
        args?.from as string | undefined,
        args?.to as string | undefined,
      );
      return text({ entries, markdown: formatChangelogMarkdown(entries) });
    }
    case "create_release": {
      const bump = (args?.bump as string) || "patch";
      if (!["patch", "minor", "major"].includes(bump)) {
        throw new Error("bump must be patch, minor, or major");
      }
      const release = createRelease(bump as "patch" | "minor" | "major");
      return text(release);
    }

    // ─── Secrets Scanner ───────────────────────────────────────────────
    case "scan_secrets": {
      const report = scanForSecrets(root, {
        paths: stringArrayArg(args?.paths, "paths"),
        severity: args?.severity as "high" | "medium" | "low" | undefined,
      });
      return text({ ...report, formatted: formatSecretsReport(report) });
    }

    // ─── ADR Manager ───────────────────────────────────────────────────
    case "adr_init": {
      const result = initADR();
      return text(result);
    }
    case "adr_new": {
      const adr = createADR({
        title: stringArg(args?.title, "title"),
        status:
          (args?.status as "proposed" | "accepted" | "deprecated" | "superseded") ?? "proposed",
        supersedes: args?.supersedes as number | undefined,
      });
      return text(adr);
    }
    case "adr_list": {
      const adrs = listADRs();
      return text({ adrs, count: adrs.length, formatted: formatADRList(adrs) });
    }
    case "adr_get": {
      const adr = getADR(Number(args?.id));
      if (!adr) throw new Error(`ADR ${args?.id} not found`);
      return text(adr);
    }
    case "adr_status": {
      const id = Number(args?.id);
      const status = stringArg(args?.status, "status") as
        | "proposed"
        | "accepted"
        | "deprecated"
        | "superseded";
      const adr = updateADRStatus(id, status);
      if (!adr) throw new Error(`ADR ${id} not found`);
      return text(adr);
    }
    case "adr_graph":
      return text({ mermaid: generateADRGraph() });

    // ─── Vulnerability Scanner & SBOM ──────────────────────────────────
    case "scan_vulnerabilities": {
      const report = scanVulnerabilities(root);
      return text({ ...report, formatted: formatVulnReport(report) });
    }
    case "generate_sbom": {
      const format = (args?.format as string) || "spdx";
      if (!["spdx", "cyclonedx"].includes(format)) {
        throw new Error("format must be spdx or cyclonedx");
      }
      const sbom = generateSBOM(root, format as "spdx" | "cyclonedx");
      return text(sbom);
    }

    // ─── Codebase Q&A ──────────────────────────────────────────────────
    case "answer_question": {
      const result = await answerQuestion(root, {
        question: stringArg(args?.question, "question"),
        maxSources: numberArg(args?.maxSources),
        includeFiles: stringArrayArg(args?.includeFiles, "includeFiles"),
      });
      return text({ ...result, formatted: formatQAResult(result) });
    }
    case "generate_onboarding_docs": {
      const docs = await generateOnboardingDocs(root);
      return text(docs);
    }

    // ─── Tier 3: Team / Sprint / Auto-Merge / Benchmark ────────────────
    case "sprint_report": {
      const since = (args?.since as string) || "7.days.ago";
      const report = generateSprintReport(since);
      return text(report);
    }
    case "team_metrics":
      return text(getTeamMetrics());
    case "pr_auto_merge": {
      const prNumber = Number(args?.prNumber);
      if (!prNumber || Number.isNaN(prNumber)) throw new Error("prNumber must be a valid number");
      const status = await checkPRAutoMerge(prNumber);
      return text(status);
    }
    case "record_benchmark": {
      const name = stringArg(args?.name, "name");
      const duration = Number(args?.duration);
      if (!duration || Number.isNaN(duration)) throw new Error("duration must be a valid number");
      const result = recordBenchmark(name, duration);
      return text(result);
    }
    case "benchmark_history": {
      const name = stringArg(args?.name, "name");
      const limit = numberArg(args?.limit) ?? 20;
      return text({ history: getBenchmarkHistory(name, limit) });
    }
    case "benchmark_regression": {
      const name = stringArg(args?.name, "name");
      return text({ regression: detectBenchmarkRegression(name) });
    }

    // ─── API Contract Tester ─────────────────────────────────────────────
    case "compare_api_specs": {
      const beforePath = stringArg(args?.beforePath, "beforePath");
      const afterPath = stringArg(args?.afterPath, "afterPath");
      const report = compareOpenApiSpecs(beforePath, afterPath);
      return text({ ...report, formatted: formatContractReport(report) });
    }
    case "diff_api_from_git": {
      const ref1 = args?.ref1 as string | undefined;
      const ref2 = args?.ref2 as string | undefined;
      const report = diffOpenApiFromGit(ref1, ref2);
      return text({ ...report, formatted: formatContractReport(report) });
    }

    // ─── Config Validator ─────────────────────────────────────────────────
    case "validate_env_file": {
      const envPath = stringArg(args?.envPath, "envPath");
      const schema = args?.schema as Record<
        string,
        { type: "string" | "number" | "boolean" | "url"; required: boolean; pattern?: string }
      >;
      const report = validateEnvFile(envPath, schema);
      return text({ ...report, formatted: formatValidationReport(report) });
    }
    case "validate_json_file": {
      const jsonPath = stringArg(args?.jsonPath, "jsonPath");
      const schema = args?.schema as Record<string, { type: string; required?: boolean }>;
      const report = validateJsonFile(jsonPath, schema);
      return text({ ...report, formatted: formatValidationReport(report) });
    }
    case "detect_missing_env_vars": {
      const requiredVars = args?.requiredVars as string[];
      const envPath = args?.envPath as string | undefined;
      if (!requiredVars || !Array.isArray(requiredVars))
        throw new Error("requiredVars must be an array of strings");
      const report = detectMissingEnvVars(requiredVars, envPath);
      return text({ ...report, formatted: formatValidationReport(report) });
    }

    // ─── License Checker ──────────────────────────────────────────────────
    case "check_licenses": {
      const rootPath = (args?.root as string) || root;
      const report = scanNpmLicenses(rootPath);
      const categorized = categorizeLicenses(report);
      return text({ ...categorized, formatted: formatLicenseReport(categorized) });
    }

    // ─── Complexity Tracker ───────────────────────────────────────────────
    case "analyze_complexity": {
      const rootPath = (args?.root as string) || root;
      const glob = args?.glob as string | undefined;
      const report = analyzeDirectory(rootPath, glob);
      return text({ ...report, formatted: formatComplexityReport(report) });
    }
    case "track_complexity_trend": {
      const rootPath = (args?.root as string) || root;
      return text(trackComplexityTrend(rootPath));
    }

    // ─── Log Analyzer ─────────────────────────────────────────────────────
    case "analyze_logs": {
      const filePath = stringArg(args?.filePath, "filePath");
      const report = analyzeLogFile(filePath);
      return text({ ...report, formatted: formatLogReport(report) });
    }

    // ─── Coverage Aggregator ──────────────────────────────────────────────
    case "aggregate_coverage": {
      const sources = args?.sources as Array<{
        tool: "jest" | "vitest" | "playwright" | "istanbul" | "nyc";
        path: string;
      }>;
      if (!sources || !Array.isArray(sources)) throw new Error("sources must be an array");
      const report = aggregateCoverage(sources);
      return text({ ...report, formatted: formatCoverageReport(report) });
    }
    case "check_coverage_threshold": {
      const sources = args?.sources as Array<{
        tool: "jest" | "vitest" | "playwright" | "istanbul" | "nyc";
        path: string;
      }>;
      const threshold = Number(args?.threshold);
      if (!sources || !Array.isArray(sources)) throw new Error("sources must be an array");
      if (!threshold || Number.isNaN(threshold))
        throw new Error("threshold must be a valid number");
      const report = aggregateCoverage(sources);
      const gate = checkCoverageThreshold(report, threshold);
      return text({ ...report, ...gate, formatted: formatCoverageReport(report) });
    }

    // ─── Git Hook Scaffolder ──────────────────────────────────────────────
    case "scaffold_git_hooks": {
      const targetDir = stringArg(args?.targetDir, "targetDir");
      const hooks = args?.hooks as Array<
        "pre-commit" | "commit-msg" | "pre-push" | "post-commit" | "post-merge"
      >;
      const linter = args?.linter as string | undefined;
      const testCommand = args?.testCommand as string | undefined;
      if (!hooks || !Array.isArray(hooks)) throw new Error("hooks must be an array");
      const result = scaffoldHooks(targetDir, { hooks, linter, testCommand });
      return text(result);
    }
    case "validate_commit_message": {
      const message = stringArg(args?.message, "message");
      const result = validateCommitMessage(message);
      return text(result);
    }

    // ─── Todo/Fixme Tracker ───────────────────────────────────────────────
    case "scan_todos": {
      const scanRoot = (args?.root as string) || root;
      const report = scanForTodos(scanRoot, {
        include: (args?.include as string)?.split(",").filter(Boolean),
        exclude: (args?.exclude as string)?.split(",").filter(Boolean),
      });
      return text({ ...report, formatted: formatTodoReport(report, { showAge: true }) });
    }
    case "todo_history": {
      const scanRoot = (args?.root as string) || root;
      return text({ history: getTodoHistory(scanRoot) });
    }

    // ─── Performance Audit ────────────────────────────────────────────────
    case "analyze_bundle": {
      const statsPath = args?.statsPath as string | undefined;
      if (statsPath) {
        const report = analyzeBundleStats(statsPath);
        return text({ ...report, formatted: formatBundleReport(report) });
      }
      const report = await parseBundlePhobia(root);
      return text({ ...report, formatted: formatBundleReport(report) });
    }
    case "compare_bundles": {
      const beforeStats = stringArg(args?.beforeStats, "beforeStats");
      const afterStats = stringArg(args?.afterStats, "afterStats");
      const before = analyzeBundleStats(beforeStats);
      const after = analyzeBundleStats(afterStats);
      const diffs = compareBundles(before, after);
      return text({
        diffs,
        before: { ...before, formatted: formatBundleReport(before) },
        after: { ...after, formatted: formatBundleReport(after) },
      });
    }
    case "generate_perf_report": {
      const perfRoot = (args?.root as string) || root;
      return text(createPerfReport(perfRoot));
    }

    // ─── i18n Helper ──────────────────────────────────────────────────────
    case "extract_i18n_strings": {
      const i18nRoot = (args?.root as string) || root;
      const strings = extractHardcodedStrings(i18nRoot, {
        excludePatterns: (args?.excludePatterns as string)?.split(",").filter(Boolean),
      });
      return text({ total: strings.length, strings });
    }
    case "check_missing_translations": {
      const i18nRoot = stringArg(args?.root, "root");
      const localesDir = stringArg(args?.localesDir, "localesDir");
      const report = checkMissingTranslation(i18nRoot, localesDir);
      return text({ ...report, formatted: formatLocaleReport(report) });
    }

    // ─── DB Schema Reporter ───────────────────────────────────────────────
    case "parse_prisma_schema": {
      const schemaPath = stringArg(args?.schemaPath, "schemaPath");
      const schemaReport = parsePrismaSchema(schemaPath);
      return text({ ...schemaReport, formatted: formatSchemaReport(schemaReport) });
    }
    case "diff_db_schemas": {
      const beforeSchema = stringArg(args?.beforeSchema, "beforeSchema");
      const afterSchema = stringArg(args?.afterSchema, "afterSchema");
      const before = parsePrismaSchema(beforeSchema);
      const after = parsePrismaSchema(afterSchema);
      const diff = compareSchemas(before, after);
      return text({ ...diff, formatted: formatSchemaDiff(diff) });
    }

    // ─── Doctor (Environment) ─────────────────────────────────────────────
    case "doctor": {
      const docRoot = (args?.root as string) || root;
      const report = generateDoctorReport(docRoot);
      return text({ ...report, formatted: formatDoctorReport(report) });
    }

    // ─── Codebase Stats ───────────────────────────────────────────────────
    case "codebase_stats": {
      const statsRoot = (args?.root as string) || root;
      const stats = generateStats(statsRoot);
      return text({ ...stats, formatted: formatStats(stats) });
    }
    case "codebase_stats_history": {
      const statsRoot = (args?.root as string) || root;
      return text(getStatsHistory(statsRoot));
    }
    case "compare_codebase_stats": {
      const statsRoot = (args?.root as string) || root;
      const current = generateStats(statsRoot);
      const history = getStatsHistory(statsRoot);
      let comparison = null;
      if (history.reports.length > 0) {
        comparison = compareStats(history.reports[history.reports.length - 1], current);
      }
      return text({
        current: { ...current, formatted: formatStats(current) },
        history,
        comparison,
      });
    }

    // ─── Sequential Thinking Handlers ─────────────────────────────────────
    case "sequential_thinking": {
      const thought = stringArg(args?.thought, "thought");
      const nextThoughtNeeded = args?.nextThoughtNeeded === true;
      const thoughtNumber = Number(args?.thoughtNumber) || 1;
      const totalThoughts = Number(args?.totalThoughts) || 1;
      const sessionId = args?.sessionId as string | undefined;

      const engine = getThinkingEngine(sessionId);
      const result = engine.processThought({
        thought,
        nextThoughtNeeded,
        thoughtNumber,
        totalThoughts,
        isRevision: args?.isRevision === true || undefined,
        revisesThought: args?.revisesThought ? Number(args.revisesThought) : undefined,
        branchFromThought: args?.branchFromThought ? Number(args.branchFromThought) : undefined,
        branchId: args?.branchId as string | undefined,
        needsMoreThoughts: args?.needsMoreThoughts === true || undefined,
      });

      if (result.isError) return result;

      return {
        content: result.content,
      };
    }
    case "sequential_thinking_export": {
      const format = (args?.format as string) ?? "markdown";
      const sessionId = args?.sessionId as string | undefined;
      const engine = getThinkingEngine(sessionId);

      if (format === "summary") {
        return text({ summary: engine.getSummary() });
      }

      // If sessionId is provided, load that session's thoughts via the engine
      if (sessionId && sessionId !== engine.getSessionId()) {
        const loaded = SequentialThinkingEngine.loadSession(sessionId);
        if (!loaded) throw new Error(`Session not found: ${sessionId}`);
        // Create a temporary engine for the loaded session
        const tempEngine = new SequentialThinkingEngine({ disableLogging: true });
        for (const t of loaded.thoughtHistory) {
          tempEngine.processThought(t);
        }
        return text(exportFromEngine(tempEngine, format));
      }

      return text(exportFromEngine(engine, format));
    }
    case "sequential_thinking_list": {
      const sessions = SequentialThinkingEngine.listSessions(
        join(cwd(), ".claude", "sequential-thinking"),
      );
      return text({ sessions, count: sessions.length });
    }
    case "sequential_thinking_reset": {
      const sessionId = args?.sessionId as string | undefined;
      const engine = getThinkingEngine(sessionId);
      const result = engine.reset();
      return text({
        reset: true,
        previousThoughts: result.previousThoughtCount,
        message: "Reset complete. New sequential_thinking calls start fresh.",
      });
    }

    default: {
      // Try delegation router before throwing
      const handler = router.getHandler(request.params.name);
      if (handler) {
        return handler(args, routerCtx());
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
  }
});

// ─── Sequential Thinking Export Helper ────────────────────────────────────────

function exportFromEngine(
  engine: SequentialThinkingEngine,
  format: string,
): Record<string, unknown> {
  switch (format) {
    case "markdown":
      return { format: "markdown", content: engine.exportMarkdown() };
    case "tree": {
      const tree = engine.exportBranchTree();
      return { format: "ascii", content: tree.ascii };
    }
    case "mermaid":
      return { format: "mermaid", content: engine.exportBranchTree().mermaid };
    default:
      return { format: "markdown", content: engine.exportMarkdown() };
  }
}

// ─── Process lifecycle — graceful shutdown ────────────────────────────────
process.on("SIGINT", async () => {
  console.error("[coder-workflow MCP] SIGINT received, shutting down...");
  await server.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  console.error("[coder-workflow MCP] SIGTERM received, shutting down...");
  await server.close();
  process.exit(0);
});
process.on("uncaughtException", (err) => {
  console.error("[coder-workflow MCP] Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[coder-workflow MCP] Unhandled rejection:", reason);
});

try {
  await server.connect(new StdioServerTransport());
} catch (err) {
  console.error("[coder-workflow MCP] Failed to connect transport:", err);
  process.exit(1);
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

interface GraphFreshness {
  exists: boolean;
  ageMinutes: number;
  isStale: boolean;
  recommendation: string;
}

async function getGraphFreshness(root: string): Promise<GraphFreshness> {
  const dbPath = join(root, ".codegraph", "graph.json");
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
