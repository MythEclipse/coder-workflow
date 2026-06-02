#!/usr/bin/env node
import { statSync, readFileSync, existsSync } from "node:fs";
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
import { diffGraphs, formatGraphDiff } from "./git-diff.js";
import { getDirectoryTree } from "./fs-tools.js";
import { summarizeGraphForBudget } from "./graph/summarize.js";
import { graphExists, readGraph, scanCodebase, writeGraph } from "./graph.js";
import { searchCodebase } from "./search.js";
import { loadSettings } from "./settings.js";
import type { CodeGraph } from "./types.js";
import { openGraphUi } from "./ui.js";

let _cachedGraph: CodeGraph | null = null;
let _cachedGraphMtime = 0;

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
}

const server = new Server(
  { name: "codegraph-mapper", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

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
      description: "Memperbarui database graf hanya untuk file-file yang baru saja berubah.",
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
        "Search source text by literal string or regex across project files before falling back to grep.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          regex: { type: "boolean" },
          caseSensitive: { type: "boolean" },
          contextLines: { type: "number" },
          maxResults: { type: "number" },
          maxFileSizeBytes: { type: "number" },
          include: { type: "array", items: { type: "string" } },
          exclude: { type: "array", items: { type: "string" } },
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
      name: "diff_graphs",
      description: "Membandingkan perbedaan struktur sebelum dan sesudah perubahan kode.",
      inputSchema: {
        type: "object",
        properties: {
          beforePath: { type: "string", description: "Path to before.json" },
          afterPath: { type: "string", description: "Path to after.json" },
        },
        required: ["beforePath", "afterPath"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const root = cwd();
  const settings = loadSettings(root);
  const args = request.params.arguments as Record<string, unknown> | undefined;

  switch (request.params.name) {
    case "scan_codebase":
    case "update_codebase": {
      const graph = await scanCodebase(root, settings);
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
    }
    case "query_graph": {
      const query = stringArg(args?.query, "query");
      return text(queryGraph(await getCachedGraph(root), query, numberArg(args?.maxResults)));
    }
    case "search_code":
      return text(
        searchCodebase(root, settings, {
          pattern: stringArg(args?.pattern, "pattern"),
          regex: args?.regex === true,
          caseSensitive: args?.caseSensitive === true,
          contextLines: numberArg(args?.contextLines),
          maxResults: numberArg(args?.maxResults),
          maxFileSizeBytes: numberArg(args?.maxFileSizeBytes),
          include: stringArrayArg(args?.include, "include"),
          exclude: stringArrayArg(args?.exclude, "exclude"),
        }),
      );
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
      return text(analyzeImpact(await getCachedGraph(root), target, Number.MAX_SAFE_INTEGER, direction));
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
