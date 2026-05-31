import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";
import { isExportedNode, isNestedSymbol, isTestPath, pathFromNodeId } from "./shared.js";

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
    const sourcePath = edge.source.startsWith("file:") ? edge.source.slice("file:".length) : nodeById.get(edge.source)?.path;
    const targetPath = edge.target.startsWith("file:") ? edge.target.slice("file:".length) : nodeById.get(edge.target)?.path;
    if (sourcePath && filePaths.has(sourcePath)) filesWithRelationships.add(sourcePath);
    if (targetPath && filePaths.has(targetPath)) filesWithRelationships.add(targetPath);

    // Unresolved imports
    if (edge.type === "imports" && edge.target.startsWith("module:")) {
      const imported = edge.target.slice("module:".length);
      if (isLocalImport(imported)) {
        const srcPath = edge.source.startsWith("file:") ? edge.source.slice("file:".length) : undefined;
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
