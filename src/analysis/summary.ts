import type { CodeGraph, CodeGraphNode } from "../types.js";

export interface ArchitectureSummary {
  directories: Record<string, number>;
  hotspots: Array<{ node: CodeGraphNode; degree: number }>;
  metadata: CodeGraph["metadata"];
}

export function summarizeArchitecture(graph: CodeGraph): ArchitectureSummary {
  const byDirectory = new Map<string, number>();
  for (const node of graph.nodes.filter((node) => node.type === "file")) {
    const dir = node.path.split("/").slice(0, -1).join("/") || ".";
    byDirectory.set(dir, (byDirectory.get(dir) ?? 0) + 1);
  }
  const degreeByNode = new Map<string, number>();
  for (const edge of graph.edges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
  }
  const hotspots = graph.nodes
    .map((node) => ({
      node,
      degree: degreeByNode.get(node.id) ?? 0,
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 20);
  return { directories: Object.fromEntries(byDirectory), hotspots, metadata: graph.metadata };
}
