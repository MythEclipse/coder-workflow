// Consolidated analysis functions — merged from src/analysis/*.ts
// These were spread across 6 files but had zero external importers except cli.ts and mcp-server.ts

import type { CodeGraph, CodeGraphNode, CodeGraphEdge, CodeGraphNodeType, CodeGraphEdgeType } from "./types.js";

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

// --- src/analysis/cycles.ts ---
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

// --- src/analysis/impact.ts ---

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

// --- src/analysis/orphans.ts ---

export type OrphanNode = CodeGraphNode & { orphanType: "file" | "symbol" };

export function findOrphans(graph: CodeGraph): OrphanNode[] {
  const fileNodes = graph.nodes.filter((n) => n.type === "file");
  const symbolNodes = graph.nodes.filter((n) => n.type !== "file" && n.type !== "module");

  const importedFilePaths = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "imports" || edge.type === "depends-on") {
      let targetPath: string | undefined;
      if (edge.target.startsWith("file:")) {
        targetPath = edge.target.slice(5);
      } else if (edge.target.startsWith("module:")) {
        const importName = edge.target.slice(7);
        const targetNode = graph.nodes.find((n) => n.type === "file" && n.path === importName);
        if (targetNode) {
          targetPath = targetNode.path;
        } else {
          const matched = graph.nodes.find(
            (n) => n.type === "file" && matchImportPath(importName, n.path),
          );
          if (matched) {
            targetPath = matched.path;
          }
        }
      }
      if (targetPath) {
        let sourcePath = "";
        if (edge.source.startsWith("file:")) {
          sourcePath = edge.source.slice(5);
        }
        if (sourcePath !== targetPath) {
          importedFilePaths.add(targetPath);
        }
      }
    }
  }

  const calledSymbolIds = new Set<string>();
  for (const edge of graph.edges) {
    if (
      ["calls", "component-usage", "extends", "implements", "route-handler"].includes(edge.type)
    ) {
      if (edge.source !== edge.target) {
        calledSymbolIds.add(edge.target);
      }
    }
  }

  const orphanFiles = fileNodes.filter((node) => {
    if (isEntryLikeFile(node)) return false;
    if (hasUsefulFileRelationship(node, graph)) return false;
    return !importedFilePaths.has(node.path);
  });

  const orphanSymbols = symbolNodes.filter((node) => {
    if (node.name === "main" || node.type === "route" || node.type === "handler") return false;
    if (isExportedNode(node, graph)) return false;
    return !calledSymbolIds.has(node.id);
  });

  return [
    ...orphanFiles.map((node): OrphanNode => ({ ...node, orphanType: "file" })),
    ...orphanSymbols.map((node): OrphanNode => ({ ...node, orphanType: "symbol" })),
  ];
}

function isEntryLikeFile(node: CodeGraphNode): boolean {
  const name = node.name.toLowerCase();
  return (
    name === "package.json" ||
    name === "tsconfig.json" ||
    name.includes("test") ||
    name.includes("spec") ||
    name.startsWith(".") ||
    name.includes("config") ||
    name.includes("main") ||
    name.includes("index") ||
    name.includes("app") ||
    name === "cli.ts" ||
    name === "server.ts"
  );
}

function hasUsefulFileRelationship(node: CodeGraphNode, graph: CodeGraph): boolean {
  return graph.edges.some((edge) => {
    if (edge.type === "exports") return false;
    return (
      pathFromNodeId(edge.source, graph.nodes) === node.path ||
      pathFromNodeId(edge.target, graph.nodes) === node.path
    );
  });
}

function matchImportPath(imported: string, filePath: string): boolean {
  const targetClean = filePath.replace(/\.(ts|tsx|js|jsx|py|go|rs|java|kt)$/, "");
  const targetNormalized = targetClean.replace(/\\/g, "/");

  let importNormalized = imported.replace(/\\/g, "/");
  importNormalized = importNormalized.replace(/^(\.\/|\.\.\/)+/, "");
  importNormalized = importNormalized.replace(/\.(ts|tsx|js|jsx|py|go|rs|java|kt)$/, "");

  return targetNormalized.endsWith(importNormalized) || importNormalized.endsWith(targetNormalized);
}

// --- src/analysis/query.ts ---
export interface QueryGraphResult {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  truncated?: boolean;
}

export function queryGraph(
  graph: CodeGraph,
  query: string,
  maxResults: number = 200,
): QueryGraphResult {
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

// --- src/analysis/summary.ts ---
export interface ArchitectureSummary {
  metadata: CodeGraph["metadata"];
  nodes: Array<{
    id: string;
    name: string;
    type: CodeGraphNodeType;
    degree: number;
    connections: Partial<Record<CodeGraphEdgeType, number>>;
  }>;
  edges: Array<{
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

  const nodes = graph.nodes
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      degree: degreeByNode.get(node.id) ?? 0,
      connections: edgeTypesByNode.get(node.id) ?? {},
    }))
    .sort((a, b) => b.degree - a.degree);

  const edges = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
    type: e.type,
  }));

  return { metadata: graph.metadata, nodes, edges };
}


// --- src/analysis/quality.ts ---
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type GraphQualitySeverity = "high" | "medium" | "low";
export type GraphQualityCategory =
  | "unresolved-import"
  | "unresolved-call"
  | "ambiguous-call"
  | "duplicate-symbol"
  | "stale-graph"
  | "coverage";

export interface GraphQualityIssue {
  severity: GraphQualitySeverity;
  category: GraphQualityCategory;
  message: string;
  nodes?: string[];
  evidence?: string;
}

export interface GraphQualityReport {
  summary: {
    issueCount: number;
    bySeverity: Record<GraphQualitySeverity, number>;
    byCategory: Partial<Record<GraphQualityCategory, number>>;
  };
  issues: GraphQualityIssue[];
  recommendations: string[];
}

export type QualityGateThreshold = GraphQualitySeverity;

export interface QualityGateResult {
  failedThreshold: QualityGateThreshold;
  wouldFail: boolean;
}

const severityRank: Record<GraphQualitySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function evaluateQualityGate(
  issues: GraphQualityIssue[],
  threshold: QualityGateThreshold,
): QualityGateResult {
  const thresholdRank = severityRank[threshold];
  return {
    failedThreshold: threshold,
    wouldFail: issues.some((issue) => severityRank[issue.severity] >= thresholdRank),
  };
}

export function analyzeGraphQuality(graph: CodeGraph, root?: string): GraphQualityReport {
  const issues: GraphQualityIssue[] = [];
  const fileNodes = graph.nodes.filter((node) => node.type === "file");
  const symbolNodes = graph.nodes.filter(
    (node) => node.type !== "file" && node.type !== "module" && node.type !== "route",
  );
  const filePaths = new Set(fileNodes.map((node) => node.path));

  // O(1) Indices
  const nodeById = new Map<string, CodeGraphNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  const exportedNodeIds = new Set<string>();
  const callEdgesBySourceEvidence = new Map<string, CodeGraphEdge[]>();
  const filesWithRelationships = new Set<string>();

  // Single pass over all edges
  for (const edge of graph.edges) {
    if (edge.type === "exports") {
      exportedNodeIds.add(edge.target);
      continue;
    }

    // Relationship coverage tracking
    const sourcePath = edge.source.startsWith("file:")
      ? edge.source.slice("file:".length)
      : nodeById.get(edge.source)?.path;
    const targetPath = edge.target.startsWith("file:")
      ? edge.target.slice("file:".length)
      : nodeById.get(edge.target)?.path;
    if (sourcePath && filePaths.has(sourcePath)) filesWithRelationships.add(sourcePath);
    if (targetPath && filePaths.has(targetPath)) filesWithRelationships.add(targetPath);

    // Unresolved imports
    if (edge.type === "imports" && edge.target.startsWith("module:")) {
      const imported = edge.target.slice("module:".length);
      if (isLocalImport(imported)) {
        const srcPath = edge.source.startsWith("file:")
          ? edge.source.slice("file:".length)
          : undefined;
        if (srcPath && !localImportMatchesAnyFile(imported, srcPath, filePaths)) {
          issues.push({
            severity: "high",
            category: "unresolved-import",
            message: `Local import ${imported} from ${srcPath} does not match a scanned file`,
            nodes: [edge.source, edge.target],
            evidence: imported,
          });
        }
      }
    }

    // Ambiguous and Unresolved calls
    if (edge.type === "calls") {
      if (typeof edge.confidence === "number" && edge.confidence < 0.5) {
        issues.push({
          severity: "medium",
          category: "ambiguous-call",
          message: `Ambiguous call edge ${edge.source} -> ${edge.target}`,
          nodes: [edge.source, edge.target],
          evidence: edge.evidence,
        });
      }
      const key = `${edge.source}:${edge.evidence ?? ""}`;
      const existing = callEdgesBySourceEvidence.get(key);
      if (existing) existing.push(edge);
      else callEdgesBySourceEvidence.set(key, [edge]);
    }
  }

  // Duplicate Symbols
  const symbolsByName = new Map<string, CodeGraphNode[]>();
  for (const node of symbolNodes) {
    const list = symbolsByName.get(node.name);
    if (list) list.push(node);
    else symbolsByName.set(node.name, [node]);
  }

  for (const [name, nodes] of symbolsByName) {
    const productionNodes = nodes.filter(
      (node) =>
        !isTestPath(node.path) &&
        exportedNodeIds.has(node.id) &&
        !isNestedSymbol(node, symbolNodes),
    );
    const paths = new Set(productionNodes.map((node) => node.path));
    if (productionNodes.length > 1 && paths.size > 1) {
      issues.push({
        severity: "low",
        category: "duplicate-symbol",
        message: `Exported symbol name ${name} appears in ${productionNodes.length} places`,
        nodes: productionNodes.map((node) => node.id),
        evidence: name,
      });
    }
  }

  // Unresolved Call checks
  for (const targets of callEdgesBySourceEvidence.values()) {
    if (targets.length > 5) {
      const edge = targets[0];
      issues.push({
        severity: "low",
        category: "unresolved-call",
        message: `Call ${edge.evidence ?? edge.target} from ${edge.source} has ${targets.length} possible targets`,
        nodes: [edge.source, ...targets.map((target) => target.target)],
        evidence: edge.evidence,
      });
    }
  }

  // Stale Graph Check
  const graphTime = Date.parse(graph.generatedAt);
  if (root && Number.isFinite(graphTime)) {
    for (const file of fileNodes) {
      const absolute = join(root, file.path);
      if (!existsSync(absolute)) continue;
      const mtime = statSync(absolute).mtimeMs;
      if (mtime > graphTime + 1000) {
        issues.push({
          severity: "medium",
          category: "stale-graph",
          message: `${file.path} is newer than graph generation time`,
          nodes: [file.id],
          evidence: file.path,
        });
      }
    }
  }

  // Coverage
  if (fileNodes.length >= 3) {
    const coverage = filesWithRelationships.size / fileNodes.length;
    if (coverage < 0.5) {
      issues.push({
        severity: "low",
        category: "coverage",
        message: `Only ${filesWithRelationships.size} of ${fileNodes.length} files have non-export relationships`,
        evidence: `${filesWithRelationships.size}/${fileNodes.length}`,
      });
    }
  }

  return {
    summary: summarizeQualityIssues(issues),
    issues: dedupeQualityIssues(issues),
    recommendations: qualityRecommendations(issues),
  };
}

function summarizeQualityIssues(issues: GraphQualityIssue[]): GraphQualityReport["summary"] {
  const bySeverity: Record<GraphQualitySeverity, number> = { high: 0, medium: 0, low: 0 };
  const byCategory: Partial<Record<GraphQualityCategory, number>> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
  }
  return { issueCount: issues.length, bySeverity, byCategory };
}

function qualityRecommendations(issues: GraphQualityIssue[]): string[] {
  const categories = new Set(issues.map((issue) => issue.category));
  const recommendations: string[] = [];
  if (categories.has("unresolved-import"))
    recommendations.push("Fix unresolved local imports or expand scanner language/path settings.");
  if (categories.has("duplicate-symbol"))
    recommendations.push("Use file paths or qualified names when querying duplicate symbols.");
  if (categories.has("ambiguous-call"))
    recommendations.push(
      "Review low-confidence call edges; consider adding type hints or refactoring ambiguous names.",
    );
  if (categories.has("unresolved-call"))
    recommendations.push("Inspect ambiguous call edges before using impact results for refactors.");
  if (categories.has("stale-graph"))
    recommendations.push("Run codegraph-mapper scan to refresh graph data.");
  if (categories.has("coverage"))
    recommendations.push(
      "Review parser coverage for files without imports, calls, routes, or component relationships.",
    );
  return recommendations;
}

function dedupeQualityIssues(issues: GraphQualityIssue[]): GraphQualityIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.category}:${issue.evidence}:${issue.nodes?.join(",") ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLocalImport(imported: string): boolean {
  return imported.startsWith("./") || imported.startsWith("../");
}

function localImportMatchesAnyFile(
  imported: string,
  sourcePath: string,
  filePaths: Set<string>,
): boolean {
  const sourceDir = sourcePath.split("/").slice(0, -1);
  const parts = imported.split("/");
  const resolved: string[] = [...sourceDir];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  const base = resolved.join("/");
  return candidateImportTargets(base).some((candidate) => filePaths.has(candidate));
}

function candidateImportTargets(base: string): string[] {
  const extensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mts",
    ".cts",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
  ];
  const sourceBase = base.replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs|py|go|rs|java|kt)$/, "");
  const candidates = [base, sourceBase];
  for (const ext of extensions) candidates.push(`${sourceBase}${ext}`);
  for (const ext of extensions) candidates.push(`${sourceBase}/index${ext}`);
  return candidates;
}
