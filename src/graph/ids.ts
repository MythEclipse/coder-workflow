import type { CodeGraphEdge, CodeGraphNode } from "../types.js";

export function nodeId(type: string, key: string): string {
  return `${type}:${key}`.replace(/\s+/g, " ");
}

export function edge(
  type: CodeGraphEdge["type"],
  source: string,
  target: string,
  evidence: string,
): CodeGraphEdge {
  return { id: `${type}:${source}->${target}`, type, source, target, evidence };
}

export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function dedupeEdges(edges: CodeGraphEdge[]): CodeGraphEdge[] {
  return dedupeById(edges);
}

export function groupByName(nodes: CodeGraphNode[]): Map<string, CodeGraphNode[]> {
  const map = new Map<string, CodeGraphNode[]>();
  for (const node of nodes) {
    const values = map.get(node.name) ?? [];
    values.push(node);
    map.set(node.name, values);
  }
  return map;
}
