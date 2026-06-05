import type { CodeGraph, CodeGraphNodeType, CodeGraphEdgeType } from "../types.js";

export interface ArchitectureSummary {
  metadata: CodeGraph["metadata"];
  coreNodes: Array<{
    id: string;
    name: string;
    type: CodeGraphNodeType;
    degree: number;
    connections: Partial<Record<CodeGraphEdgeType, number>>;
  }>;
  keyConnections: Array<{
    source: string;
    target: string;
    type: CodeGraphEdgeType;
  }>;
}

export function summarizeArchitecture(graph: CodeGraph): ArchitectureSummary {
  const edgeTypesByNode = new Map<string, Partial<Record<CodeGraphEdgeType, number>>>();
  const degreeByNode = new Map<string, number>();

  for (const edge of graph.edges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);

    if (!edgeTypesByNode.has(edge.source)) edgeTypesByNode.set(edge.source, {});
    const sourceTypes = edgeTypesByNode.get(edge.source)!;
    sourceTypes[edge.type] = (sourceTypes[edge.type] ?? 0) + 1;

    if (!edgeTypesByNode.has(edge.target)) edgeTypesByNode.set(edge.target, {});
    const targetTypes = edgeTypesByNode.get(edge.target)!;
    targetTypes[edge.type] = (targetTypes[edge.type] ?? 0) + 1;
  }

  const coreNodes = graph.nodes
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      degree: degreeByNode.get(node.id) ?? 0,
      connections: edgeTypesByNode.get(node.id) ?? {},
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 20);

  const coreNodeIds = new Set(coreNodes.map((n) => n.id));
  const keyConnections = graph.edges
    .filter((e) => coreNodeIds.has(e.source) && coreNodeIds.has(e.target))
    .slice(0, 50)
    .map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    }));

  return { metadata: graph.metadata, coreNodes, keyConnections };
}
