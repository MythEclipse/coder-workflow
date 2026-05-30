import type { CodeGraph, CodeGraphNode } from "../types.js";

export function pathFromNodeId(id: string, nodes: CodeGraphNode[]): string | undefined {
  if (id.startsWith("file:")) return id.slice("file:".length);
  return nodes.find((node) => node.id === id)?.path;
}

export function isTestPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.includes("test") || normalized.includes("spec");
}

export function isExportedNode(node: CodeGraphNode, graph: CodeGraph): boolean {
  return graph.edges.some((edge) => edge.type === "exports" && edge.target === node.id);
}

export function isNestedSymbol(node: CodeGraphNode, symbolNodes: CodeGraphNode[]): boolean {
  const startLine = node.startLine;
  const endLine = node.endLine;
  if (typeof startLine !== "number" || typeof endLine !== "number") return false;
  return symbolNodes.some(
    (parent) =>
      parent.id !== node.id &&
      parent.path === node.path &&
      typeof parent.startLine === "number" &&
      typeof parent.endLine === "number" &&
      parent.startLine < startLine &&
      parent.endLine >= endLine,
  );
}
