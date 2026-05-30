import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeEdges, edge } from "../ids.js";

export function extractComponentUsageEdges(
  source: string,
  symbols: CodeGraphNode[],
  symbolByName: Map<string, CodeGraphNode[]>,
): CodeGraphEdge[] {
  const edges: CodeGraphEdge[] = [];

  for (const symbol of symbols.filter((item) => /^[A-Z]/.test(item.name))) {
    const start = componentLineOffset(source, symbol.line ?? 1);
    const next = symbols.find((candidate) => (candidate.line ?? 0) > (symbol.line ?? 0));
    const body = source.slice(
      start,
      next ? componentLineOffset(source, next.line ?? 1) : source.length,
    );

    for (const match of body.matchAll(/<([A-Z][A-Za-z_$\d]*)\b/g)) {
      pushComponentUsageEdges(edges, "component-usage", symbol.name, match[1], symbolByName);
    }
  }

  return dedupeEdges(edges);
}

function pushComponentUsageEdges(
  edges: CodeGraphEdge[],
  type: CodeGraphEdge["type"],
  sourceName: string,
  targetName: string,
  symbolByName: Map<string, CodeGraphNode[]>,
): void {
  for (const source of symbolByName.get(sourceName) ?? []) {
    for (const target of symbolByName.get(targetName) ?? []) {
      edges.push(edge(type, source.id, target.id, targetName));
    }
  }
}

function componentLineOffset(source: string, line: number): number {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
  }
  return offset;
}
