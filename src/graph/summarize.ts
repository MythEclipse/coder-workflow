import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";

export interface GraphSummaryBudget {
  maxNodes: number;
  maxEdges: number;
}

export interface BudgetedGraphSummary {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  omitted: { nodes: number; edges: number };
  hotspots: Array<{ id: string; degree: number }>;
}

export function summarizeGraphForBudget(
  graph: CodeGraph,
  budget: GraphSummaryBudget,
): BudgetedGraphSummary {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const nodes = [...graph.nodes]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, budget.maxNodes);
  const included = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => included.has(edge.source) || included.has(edge.target))
    .slice(0, budget.maxEdges);

  return {
    nodes,
    edges,
    omitted: {
      nodes: Math.max(0, graph.nodes.length - nodes.length),
      edges: Math.max(0, graph.edges.length - edges.length),
    },
    hotspots: nodes.map((node) => ({
      id: node.id,
      degree: degree.get(node.id) ?? 0,
    })),
  };
}
