import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";

export interface QueryGraphResult {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  truncated?: boolean;
}

export function queryGraph(graph: CodeGraph, query: string, maxResults: number = 200): QueryGraphResult {
  const needle = query.toLowerCase();
  const allNodes = graph.nodes.filter(
    (node) =>
      node.id.toLowerCase().includes(needle) ||
      node.name.toLowerCase().includes(needle) ||
      node.path.toLowerCase().includes(needle),
  );
  
  const truncated = allNodes.length > maxResults;
  const nodes = truncated ? allNodes.slice(0, maxResults) : allNodes;
  
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
  
  return { nodes, edges, truncated };
}
