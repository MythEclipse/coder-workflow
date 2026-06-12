/**
 * Dead Code Detector — backward-compatible alias for graph-based detection.
 */
import { graphExists, readGraph } from "./graph.js";
import type { CodeGraph, CodeGraphNode, CodeGraphEdge } from "./types.js";

export interface DeadCodeReport {
  totalNodes: number;
  totalEdges: number;
  unusedExports: Array<{ symbol: string; file: string; type: string; line?: number }>;
  orphanFiles: Array<{ file: string; path: string }>;
  uncalledFunctions: Array<{ name: string; file: string; line?: number }>;
  totalDead: number;
  estimatedBytes: number;
}

export async function detectDeadCodeFromGraph(root: string): Promise<DeadCodeReport | { error: string }> {
  if (!(await graphExists(root))) {
    return { error: "No graph database found. Run scan_codebase first or use --skip-graph." };
  }
  const graph = await readGraph(root);

  // Index: which symbols/files are referenced
  const importRefs = new Map<string, number>();
  const callRefs = new Map<string, number>();
  const fileDeps = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.type === "imports") {
      importRefs.set(edge.target, (importRefs.get(edge.target) ?? 0) + 1);
    }
    if (edge.type === "calls") {
      callRefs.set(edge.target, (callRefs.get(edge.target) ?? 0) + 1);
    }
    if (edge.type === "depends-on" && edge.target.startsWith("file:")) {
      fileDeps.add(edge.target);
    }
  }

  const fileNodes = graph.nodes.filter(n => n.type === "file");
  const symbolNodes = graph.nodes.filter(n => n.type !== "file" && n.type !== "module");

  // Files with no depends-on edges pointing TO them
  const fileIdSet = new Set(fileNodes.map(n => `file:${n.path}`));
  const orphanFiles: DeadCodeReport["orphanFiles"] = fileNodes
    .filter(n => !fileDeps.has(`file:${n.path}`))
    .filter(n => n.path !== "index.ts" && n.path !== "main.ts" && n.path !== "cli.ts" && n.path !== "mcp-server.ts")
    .filter(n => !n.path.startsWith("dist/") && !n.path.startsWith("node_modules/"))
    .filter((_, i, arr) => arr.length > 1) // only if more than 1 file
    .map(n => ({ file: n.name, path: n.path }));

  // Exported symbols with no imports
  const exportEdges = graph.edges.filter(e => e.type === "exports");
  const importedSymbols = new Set(graph.edges.filter(e => e.type === "imports").map(e => e.target));
  const callTargets = new Set(graph.edges.filter(e => e.type === "calls").map(e => e.target));

  const unusedExports: DeadCodeReport["unusedExports"] = [];
  for (const edge of exportEdges) {
    const node = graph.nodes.find(n => n.id === edge.target);
    if (!node || node.type === "module") continue;
    if (importedSymbols.has(node.id) || callTargets.has(node.id)) continue;
    const filePath = edge.source.startsWith("file:") ? edge.source.slice(5) : "unknown";
    unusedExports.push({ symbol: node.name, file: filePath, type: node.type, line: node.line });
  }

  // Uncalled functions
  const uncalledFunctions: DeadCodeReport["uncalledFunctions"] = [];
  for (const node of symbolNodes) {
    if (node.type !== "function" && node.type !== "method") continue;
    if (callRefs.has(node.id)) continue;
    const hasExport = exportEdges.some(e => e.target === node.id);
    if (!hasExport) continue;
    const fileEdge = exportEdges.find(e => e.target === node.id);
    const fileName = fileEdge?.source.startsWith("file:") ? fileEdge.source.slice(5) : "unknown";
    uncalledFunctions.push({ name: node.name, file: fileName, line: node.line });
  }

  const totalDead = unusedExports.length + orphanFiles.length + uncalledFunctions.length;
  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    unusedExports,
    orphanFiles,
    uncalledFunctions,
    totalDead,
    estimatedBytes: totalDead * 1500,
  };
}
