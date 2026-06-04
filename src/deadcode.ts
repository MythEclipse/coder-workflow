#!/usr/bin/env node
/**
 * Dead Code Detector
 *
 * Uses CodeGraph edge data to find:
 * 1. Exported symbols without any imports/references
 * 2. Files without any imports (orphans)
 * 3. Functions never called (zero incoming call edges)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { graphExists, readGraph } from "./graph.js";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "./types.js";

export interface DeadCodeReport {
  totalNodes: number;
  totalEdges: number;
  /** Exports with zero incoming references */
  unusedExports: Array<{
    symbol: string;
    file: string;
    type: string;
    line?: number;
  }>;
  /** Files that no other file depends on */
  orphanFiles: Array<{
    file: string;
    path: string;
  }>;
  /** Functions/methods with zero callers */
  uncalledFunctions: Array<{
    name: string;
    file: string;
    line?: number;
  }>;
  /** Total dead items found */
  totalDead: number;
  /** Estimated bytes of dead code (source size) */
  estimatedBytes: number;
}

export function detectDeadCode(graph: CodeGraph): DeadCodeReport {
  const { nodes, edges } = graph;

  // Build index: source ID → outgoing edges, target ID → incoming edges
  const incomingEdges = new Map<string, CodeGraphEdge[]>();
  const outgoingEdges = new Map<string, CodeGraphEdge[]>();

  for (const edge of edges) {
    // Incoming to target
    const inc = incomingEdges.get(edge.target) ?? [];
    inc.push(edge);
    incomingEdges.set(edge.target, inc);

    // Outgoing from source
    const out = outgoingEdges.get(edge.source) ?? [];
    out.push(edge);
    outgoingEdges.set(edge.source, out);
  }

  // 1. Unused exports: node with "exports" edge FROM a file, but no "imports" edge TO it
  const exportNodes = new Map<string, { node: CodeGraphNode; file: string }>();
  const importedNodes = new Set<string>();

  for (const edge of edges) {
    if (edge.type === "exports") {
      const node = nodes.find((n) => n.id === edge.target);
      if (node && edge.source.startsWith("file:")) {
        const fileName = edge.source.slice("file:".length);
        exportNodes.set(edge.target, { node, file: fileName });
      }
    }
    if (edge.type === "imports" || edge.type === "depends-on") {
      importedNodes.add(edge.target);
    }
  }

  // Nodes that are imported via depends-on
  for (const edge of edges) {
    if (edge.type === "depends-on") {
      importedNodes.add(edge.target);
    }
  }

  // Also count incoming edges besides imports/exports
  const incomingNonExport = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== "exports" && edge.type !== "imports") {
      incomingNonExport.add(edge.target);
    }
  }

  const unusedExports: DeadCodeReport["unusedExports"] = [];
  for (const [nodeId, { node, file }] of exportNodes) {
    // Skip module nodes (external packages)
    if (node.type === "module") continue;
    // Skip file nodes
    if (node.type === "file") continue;

    const hasImport = importedNodes.has(nodeId);
    const hasIncomingEdge = incomingNonExport.has(nodeId);

    if (!hasImport && !hasIncomingEdge) {
      unusedExports.push({
        symbol: node.name,
        file,
        type: node.type,
        line: node.startLine ?? node.line,
      });
    }
  }

  // 2. Orphan files: file nodes with no depends-on edges pointing TO them
  const fileNodes = nodes.filter((n) => n.type === "file");
  const dependedFiles = new Set<string>();
  for (const edge of edges) {
    if (edge.type === "depends-on" && edge.target.startsWith("file:")) {
      dependedFiles.add(edge.target);
    }
  }

  const orphanFiles: DeadCodeReport["orphanFiles"] = [];
  for (const fileNode of fileNodes) {
    // Skip root/entry files
    if (fileNode.path === "index.ts" || fileNode.path === "main.ts" || fileNode.path === "cli.ts")
      continue;
    if (fileNode.path === "mcp-server.ts") continue;
    if (fileNode.path.startsWith("dist/") || fileNode.path.startsWith("node_modules/")) continue;

    const fileEdgeId = `file:${fileNode.path}`;
    if (!dependedFiles.has(fileEdgeId)) {
      orphanFiles.push({
        file: fileNode.name,
        path: fileNode.path,
      });
    }
  }

  // 3. Uncalled functions: function/method nodes with zero incoming call edges
  const callTargets = new Set<string>();
  for (const edge of edges) {
    if (edge.type === "calls") {
      callTargets.add(edge.target);
    }
  }

  const uncalledFunctions: DeadCodeReport["uncalledFunctions"] = [];
  for (const node of nodes) {
    if (node.type !== "function" && node.type !== "method") continue;
    // If it's exported, check if it's imported rather than called
    const isCallable = callTargets.has(node.id);
    // Skip if it has active incoming edges
    const inc = incomingEdges.get(node.id);
    const hasIncomingImport = inc?.some((e) => e.type === "exports") ?? false;
    const hasIncomingCall = inc?.some((e) => e.type === "calls") ?? false;

    if (!isCallable && !hasIncomingCall && hasIncomingImport) {
      // Exported but never called — potential dead code
      const fileEdge = edges.find((e) => e.type === "exports" && e.target === node.id);
      const fileName = fileEdge?.source.slice("file:".length) ?? "unknown";
      uncalledFunctions.push({
        name: node.name,
        file: fileName,
        line: node.startLine ?? node.line,
      });
    }

    // If no edges at all to this symbol and it's in source (not node_modules)
    if (!inc || inc.length === 0) {
      if (!node.id.startsWith("module:") && !node.id.startsWith("file:")) {
        const fileEdge = edges.find((e) => e.type === "exports" && e.target === node.id);
        if (fileEdge) {
          const fileName = fileEdge.source.slice("file:".length);
          uncalledFunctions.push({
            name: node.name,
            file: fileName,
            line: node.startLine ?? node.line,
          });
        }
      }
    }
  }

  const totalDead = unusedExports.length + orphanFiles.length + uncalledFunctions.length;
  const estimatedBytes = totalDead * 1500; // rough estimate

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    unusedExports,
    orphanFiles,
    uncalledFunctions,
    totalDead,
    estimatedBytes,
  };
}

export async function detectDeadCodeFromGraph(
  root: string,
): Promise<DeadCodeReport | { error: string }> {
  if (!(await graphExists(root))) {
    return { error: "No graph database found. Run scan_codebase first or use --skip-graph." };
  }
  const graph = await readGraph(root);
  return detectDeadCode(graph);
}
