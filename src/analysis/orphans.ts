import type { CodeGraph, CodeGraphNode } from "../types.js";
import { isExportedNode, pathFromNodeId } from "./shared.js";

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
