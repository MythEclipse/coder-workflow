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
  direction: "upstream" | "downstream" | "both" = "both",
): ImpactAnalysisResult {
  const isRegex = target.startsWith("/") && target.endsWith("/");
  let regex: RegExp | undefined;
  if (isRegex) {
    try {
      regex = new RegExp(target.slice(1, -1));
    } catch {
      console.warn("[impact] Regex invalid, falling back to exact match");
    }
  }

  const matches = graph.nodes.filter((node) => {
    if (regex) return regex.test(node.id) || regex.test(node.name) || regex.test(node.path);
    return node.id === target || node.name === target || node.path === target;
  });

  const matchIds = new Set(matches.map((node) => node.id));
  const upstreamAdjacency = new Map<string, CodeGraphEdge[]>();
  const downstreamAdjacency = new Map<string, CodeGraphEdge[]>();

  for (const edge of graph.edges) {
    if (!isImpactTraversalEdge(edge)) continue;
    if (direction === "both" || direction === "upstream") {
      const uList = upstreamAdjacency.get(edge.target);
      if (uList) uList.push(edge);
      else upstreamAdjacency.set(edge.target, [edge]);
    }
    if (direction === "both" || direction === "downstream") {
      const dList = downstreamAdjacency.get(edge.source);
      if (dList) dList.push(edge);
      else downstreamAdjacency.set(edge.source, [edge]);
    }
  }

  const upstream =
    direction === "both" || direction === "upstream"
      ? traverseImpact(matchIds, upstreamAdjacency, "source", maxDepth)
      : { edges: new Map(), visited: new Map() };

  const downstream =
    direction === "both" || direction === "downstream"
      ? traverseImpact(matchIds, downstreamAdjacency, "target", maxDepth)
      : { edges: new Map(), visited: new Map() };

  const directUpstream = graph.edges.filter((edge) => matchIds.has(edge.target));
  const directDownstream = graph.edges.filter((edge) => matchIds.has(edge.source));

  const upstreamAffected = Math.max(0, upstream.visited.size - matchIds.size);
  const downstreamAffected = Math.max(0, downstream.visited.size - matchIds.size);
  const affectedNodeCount = upstreamAffected + downstreamAffected;

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
  return (
    edge.type === "imports" ||
    edge.type === "depends-on" ||
    edge.type === "calls" ||
    edge.type === "extends" ||
    edge.type === "implements" ||
    edge.type === "component-usage" ||
    edge.type === "route-handler"
  );
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
    const neighbors = adjacency.get(item.id);
    if (!neighbors) continue;

    for (const edge of neighbors) {
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
