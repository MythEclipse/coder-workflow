import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";
import { pathFromNodeId } from "./shared.js";

export interface ImpactAnalysisResult {
  target: string;
  matches: CodeGraphNode[];
  directUpstream: CodeGraphEdge[];
  directDownstream: CodeGraphEdge[];
  transitiveUpstreamEdges: CodeGraphEdge[];
  transitiveDownstreamEdges: CodeGraphEdge[];
  upstreamVisited: Record<string, number>;
  downstreamVisited: Record<string, number>;
  riskLevel: "high" | "medium" | "low";
}

export function analyzeImpact(
  graph: CodeGraph,
  target: string,
  maxDepth: number = 4,
): ImpactAnalysisResult {
  const matches = graph.nodes.filter(
    (node) => node.id.includes(target) || node.name === target || node.path === target,
  );
  const matchIds = new Set(matches.map((node) => node.id));
  const upstreamAdjacency = new Map<string, CodeGraphEdge[]>();
  const downstreamAdjacency = new Map<string, CodeGraphEdge[]>();

  for (const edge of graph.edges.filter(isImpactTraversalEdge)) {
    upstreamAdjacency.set(edge.target, [...(upstreamAdjacency.get(edge.target) ?? []), edge]);
    downstreamAdjacency.set(edge.source, [...(downstreamAdjacency.get(edge.source) ?? []), edge]);
  }

  const upstream = traverseImpact(matchIds, upstreamAdjacency, "source", maxDepth);
  const downstream = traverseImpact(matchIds, downstreamAdjacency, "target", maxDepth);
  const directUpstream = graph.edges.filter((edge) => matchIds.has(edge.target));
  const directDownstream = graph.edges.filter((edge) => matchIds.has(edge.source));
  const affectedNodeCount =
    upstream.visited.size - matchIds.size + (downstream.visited.size - matchIds.size);
  const affectedCrossFileEdges = [...upstream.edges.values(), ...downstream.edges.values()].filter(
    (edge) => pathFromNodeId(edge.source, graph.nodes) !== pathFromNodeId(edge.target, graph.nodes),
  ).length;
  const riskScore = affectedNodeCount + affectedCrossFileEdges;

  return {
    target,
    matches,
    directUpstream,
    directDownstream,
    transitiveUpstreamEdges: [...upstream.edges.values()],
    transitiveDownstreamEdges: [...downstream.edges.values()],
    upstreamVisited: Object.fromEntries(upstream.visited),
    downstreamVisited: Object.fromEntries(downstream.visited),
    riskLevel: riskScore > 20 ? "high" : riskScore > 5 ? "medium" : "low",
  };
}

function isImpactTraversalEdge(edge: CodeGraphEdge): boolean {
  return [
    "imports",
    "depends-on",
    "calls",
    "extends",
    "implements",
    "component-usage",
    "route-handler",
  ].includes(edge.type);
}

function traverseImpact(
  roots: Set<string>,
  adjacency: Map<string, CodeGraphEdge[]>,
  nextKey: "source" | "target",
  maxDepth: number,
): { edges: Map<string, CodeGraphEdge>; visited: Map<string, number> } {
  const edges = new Map<string, CodeGraphEdge>();
  const visited = new Map<string, number>();
  const queue: { id: string; depth: number }[] = [];
  for (const id of roots) {
    visited.set(id, 0);
    queue.push({ id, depth: 0 });
  }

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (item.depth >= maxDepth) continue;
    for (const edge of adjacency.get(item.id) ?? []) {
      const next = edge[nextKey];
      edges.set(edge.id, edge);
      if (!visited.has(next)) {
        visited.set(next, item.depth + 1);
        queue.push({ id: next, depth: item.depth + 1 });
      }
    }
  }
  return { edges, visited };
}
