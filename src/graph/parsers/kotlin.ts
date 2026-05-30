import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeById, dedupeEdges, edge, nodeId } from "../ids.js";
import type { LanguageParser } from "./LanguageParser.js";
import {
  controlFlowKeywords,
  defaultResolveSymbolRanges,
  joinRoute,
  lastSegment,
  replaceWithSpaces,
  resolveJavaKotlinPackageImport,
  sanitizeBraceLanguage,
} from "./utils.js";

export const kotlinParser: LanguageParser = {
  language: "kotlin",

  sanitize(source: string): string {
    let result = sanitizeBraceLanguage(source);
    // Kotlin triple-quoted strings
    result = replaceWithSpaces(result, /"""[\s\S]*?"""/g);
    return result;
  },

  extractSymbols(source: string, path: string): CodeGraphNode[] {
    const nodes: CodeGraphNode[] = [];

    // Type declarations:
    //   class / data class / sealed class / abstract class / open class / inner class
    //   interface / enum class / annotation class / object / companion object
    const typePattern =
      /(?:^|\n)[ \t]*(?:(?:@\w+(?:\([^)]*\))?\s+)*)(?:(?:private|protected|internal|public)\s+)?(?:(?:data|sealed|abstract|open|inner|annotation|value|inline|external)\s+)*?(class|interface|object|enum\s+class)\s+([A-Za-z_]\w*)/gm;

    for (const match of source.matchAll(typePattern)) {
      const name = match[2];
      if (!name || controlFlowKeywords.has(name)) continue;
      const line = source.slice(0, (match.index ?? 0) + match[0].indexOf(name)).split("\n").length;
      nodes.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "class",
        name,
        path,
        language: "kotlin",
        line,
      });
    }

    // Named companion objects: `companion object Companion`
    for (const match of source.matchAll(/companion\s+object\s+([A-Za-z_]\w*)/g)) {
      const name = match[1];
      if (controlFlowKeywords.has(name)) continue;
      const line = source.slice(0, (match.index ?? 0) + match[0].indexOf(name)).split("\n").length;
      nodes.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "class",
        name,
        path,
        language: "kotlin",
        line,
      });
    }

    // Functions
    const funPattern =
      /(?:^|\n)[ \t]*(?:(?:@\w+(?:\([^)]*\))?\s+)*)(?:(?:private|protected|internal|public|override|open|abstract|inline|operator|infix|tailrec|external|expect|actual)\s+)*(?:suspend\s+)?fun\s+(?:<[^>]*>\s+)?(?:[A-Za-z_][\w.]*\.)?([A-Za-z_]\w*)\s*[(<]/gm;

    for (const match of source.matchAll(funPattern)) {
      const name = match[1];
      if (!name || controlFlowKeywords.has(name)) continue;
      const line = source.slice(0, (match.index ?? 0) + match[0].indexOf(name)).split("\n").length;
      if (nodes.some((n) => n.name === name && n.line === line)) continue;
      nodes.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "function",
        name,
        path,
        language: "kotlin",
        line,
      });
    }

    return dedupeById(nodes);
  },

  extractImports(source: string): string[] {
    const imports: string[] = [];
    const importPattern = /^\s*import\s+([\w.]+)/gm;
    for (const match of source.matchAll(importPattern)) {
      imports.push(match[1]);
    }
    return imports;
  },

  parseImports(source: string): Map<string, string> {
    const map = new Map<string, string>();
    const importPattern = /import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*;?/g;
    for (const match of source.matchAll(importPattern)) {
      const full = match[1].trim();
      const name = match[2]?.trim() ?? lastSegment(full, ".");
      if (name && !name.includes(".")) map.set(name, full);
    }
    return map;
  },

  extractRoutes(source: string, path: string): CodeGraphNode[] {
    const routes: CodeGraphNode[] = [];

    // Ktor DSL
    for (const match of source.matchAll(
      /\b(?:get|post|put|patch|delete|route|options|head)\s*\(\s*["']([^"']+)["']/g,
    )) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      routes.push({
        id: nodeId("route", `${path}:${match[1]}`),
        type: "route",
        name: match[1],
        path,
        language: "kotlin",
        line,
      });
    }

    // Spring Boot Kotlin
    const classRouteMatch =
      source.match(/@RequestMapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/) ?? undefined;
    const classRoute = classRouteMatch?.[1];

    for (const match of source.matchAll(/@RequestMapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g)) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      routes.push({
        id: nodeId("route", `${path}:${match[1]}`),
        type: "route",
        name: match[1],
        path,
        language: "kotlin",
        line,
      });
    }
    for (const match of source.matchAll(
      /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g,
    )) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const name = joinRoute(classRoute, match[2]);
      routes.push({
        id: nodeId("route", `${path}:${name}`),
        type: "route",
        name,
        path,
        language: "kotlin",
        line,
      });
    }

    return dedupeById(routes);
  },

  extractRelationshipEdges(
    source: string,
    symbols: CodeGraphNode[],
    symbolByName: Map<string, CodeGraphNode[]>,
  ): CodeGraphEdge[] {
    const edges: CodeGraphEdge[] = [];

    // Kotlin colon-based inheritance
    for (const match of source.matchAll(
      /(?:class|object)\s+([A-Za-z_]\w*)(?:<[^>]*>)?\s*(?:\([^)]*\))?\s*:\s*([\w\s,<>()[\]?.]+?)(?:\s*\{|$)/gm,
    )) {
      const className = match[1];
      const rawList = match[2].replace(/<[^>]*>/g, "");
      for (const entry of rawList.split(",")) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (trimmed.endsWith(")")) {
          const superName = trimmed.replace(/\(.*\)$/, "").trim();
          if (superName) pushNamedEdges(edges, "extends", className, superName, symbolByName);
        } else {
          const ifaceName = trimmed.replace(/\(.*\)$/, "").trim();
          if (ifaceName) pushNamedEdges(edges, "implements", className, ifaceName, symbolByName);
        }
      }
    }

    return dedupeEdges(
      edges.filter((candidate) => symbols.some((symbol) => candidate.source === symbol.id)),
    );
  },

  resolveSymbolRanges(
    source: string,
    symbols: CodeGraphNode[],
  ): Map<string, { startLine: number; endLine: number }> {
    return defaultResolveSymbolRanges(source, symbols);
  },

  resolveImportTarget(
    imported: string,
    sourcePath: string,
    filePaths: Set<string>,
    context?: {
      packages?: Map<string, string>;
      root?: string;
      pathAliases?: Array<{ prefix: string; targets: string[] }>;
    },
  ): string | undefined {
    return resolveJavaKotlinPackageImport(imported, filePaths, [".java", ".kt"]);
  },

  matchImport(imported: string, targetPath: string, sourcePath?: string): boolean {
    const targetClean = targetPath.replace(/\.(java|kt)$/, "");
    const targetNormalized = targetClean.replace(/\\/g, "/");

    let importNormalized = imported.replace(/\\/g, "/");
    importNormalized = importNormalized.replace(/^(\.\/|\.\.\/)+/, "");
    importNormalized = importNormalized.replace(/\.(java|kt)$/, "");

    const importSlash = importNormalized.replace(/\./g, "/");
    return targetNormalized.endsWith(importSlash);
  },
};

function pushNamedEdges(
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
