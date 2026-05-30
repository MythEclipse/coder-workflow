import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "./types.js";

export interface GraphDiff {
  addedNodes: CodeGraphNode[];
  removedNodes: CodeGraphNode[];
  addedEdges: CodeGraphEdge[];
  removedEdges: CodeGraphEdge[];
  risk: "low" | "medium" | "high";
}

export function diffGraphs(before: CodeGraph, after: CodeGraph): GraphDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edge.id, edge]));

  const addedNodes = [...afterNodes.values()].filter((node) => !beforeNodes.has(node.id));
  const removedNodes = [...beforeNodes.values()].filter((node) => !afterNodes.has(node.id));
  const addedEdges = [...afterEdges.values()].filter((edge) => !beforeEdges.has(edge.id));
  const removedEdges = [...beforeEdges.values()].filter((edge) => !afterEdges.has(edge.id));

  const changed = addedNodes.length + removedNodes.length + addedEdges.length + removedEdges.length;
  const risk = changed > 50 ? "high" : changed > 10 ? "medium" : "low";

  return { addedNodes, removedNodes, addedEdges, removedEdges, risk };
}

export function formatGraphDiff(diff: GraphDiff): string {
  return [
    "## Graph Diff",
    `Risk: ${diff.risk}`,
    `Added nodes: ${diff.addedNodes.length}`,
    `Removed nodes: ${diff.removedNodes.length}`,
    `Added edges: ${diff.addedEdges.length}`,
    `Removed edges: ${diff.removedEdges.length}`,
  ].join("\n");
}
