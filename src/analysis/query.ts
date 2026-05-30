import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";

export interface QueryGraphResult {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

export function queryGraph(graph: CodeGraph, query: string): QueryGraphResult {
  const needle = query.toLowerCase();
  const nodes = graph.nodes.filter(
    (node) =>
      node.id.toLowerCase().includes(needle) ||
      node.name.toLowerCase().includes(needle) ||
      node.path.toLowerCase().includes(needle),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
  return { nodes, edges };
}
