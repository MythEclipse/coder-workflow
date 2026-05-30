import type { CodeGraph } from "../types.js";

export function findCycles(graph: CodeGraph): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges.filter(
    (edge) => edge.type === "imports" || edge.type === "depends-on",
  )) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }

  const cyclesMap = new Map<string, string[]>();

  function normalizeCycle(path: string[]): string[] {
    const minVal = [...path].sort()[0];
    const minIdx = path.indexOf(minVal);
    return [...path.slice(minIdx), ...path.slice(0, minIdx)];
  }

  const globalVisited = new Set<string>();
  const recursionStack = new Set<string>();
  const currentPath: string[] = [];

  function dfs(node: string) {
    if (recursionStack.has(node)) {
      const cycleStartIdx = currentPath.indexOf(node);
      if (cycleStartIdx !== -1) {
        const cycle = currentPath.slice(cycleStartIdx);
        const normalized = normalizeCycle(cycle);
        const key = normalized.join("->");
        cyclesMap.set(key, normalized);
      }
      return;
    }
    if (globalVisited.has(node)) return;

    globalVisited.add(node);
    recursionStack.add(node);
    currentPath.push(node);

    for (const next of adjacency.get(node) ?? []) {
      dfs(next);
    }

    currentPath.pop();
    recursionStack.delete(node);
  }

  for (const start of adjacency.keys()) {
    dfs(start);
  }

  return [...cyclesMap.values()].slice(0, 50);
}
