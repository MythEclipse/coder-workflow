import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeById, dedupeEdges, edge, nodeId } from "../ids.js";
import type { LanguageParser } from "./LanguageParser.js";
import {
  controlFlowKeywords,
  defaultResolveSymbolRanges,
  joinRoute,
  lastSegment,
  resolveJavaKotlinPackageImport,
  sanitizeBraceLanguage,
} from "./utils.js";

export const javaParser: LanguageParser = {
  language: "java",

  sanitize(source: string): string {
    return sanitizeBraceLanguage(source);
  },

  extractSymbols(source: string, path: string): CodeGraphNode[] {
    const nodes: CodeGraphNode[] = [];

    // Classes, interfaces, enums, annotation types (@interface)
    const typePattern =
      /(?:^|\n)[ \t]*(?:(?:public|protected|private|static|abstract|final|sealed|non-sealed)\s+)*(?:class|interface|enum|@interface)\s+([A-Za-z_]\w*)/g;
    for (const match of source.matchAll(typePattern)) {
      const name = match[1];
      if (controlFlowKeywords.has(name)) continue;
      const line = source.slice(0, (match.index ?? 0) + match[0].indexOf(name)).split("\n").length;
      nodes.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "class", // All Java type declarations map to "class"
        name,
        path,
        language: "java",
        line,
      });
    }

    // Methods
    const methodPattern =
      /(?:^|\n)([ \t]*)(?:(?:@\w+(?:\([^)]*\))?\s+)*)(?:(?:public|protected|private|static|abstract|synchronized|native|default|final|strictfp)\s+)*(?:<[^>]*>\s+)?(?:[\w][\w\s,<>[\]?.]*?)\s+([A-Za-z_]\w*)\s*\(/gm;
    for (const match of source.matchAll(methodPattern)) {
      const name = match[2];
      if (!name || controlFlowKeywords.has(name)) continue;
      if (
        [
          "class",
          "interface",
          "enum",
          "new",
          "return",
          "throw",
          "if",
          "while",
          "for",
          "switch",
        ].includes(name)
      )
        continue;

      const line = source
        .slice(0, (match.index ?? 0) + match[0].indexOf(name + "("))
        .split("\n").length;
      if (nodes.some((n) => n.name === name && n.line === line)) continue;
      nodes.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "method",
        name,
        path,
        language: "java",
        line,
      });
    }

    return dedupeById(nodes);
  },

  extractImports(source: string): string[] {
    const imports: string[] = [];
    const importPattern = /^\s*import\s+(?:static\s+)?([\w.*]+);?/gm;
    for (const match of source.matchAll(importPattern)) {
      imports.push(match[1]);
    }
    return imports;
  },

  parseImports(source: string): Map<string, string> {
    const map = new Map<string, string>();
    const importPattern = /^\s*import\s+(?:static\s+)?([\w.*]+)(?:\s+as\s+(\w+))?\s*;?/gm;
    for (const match of source.matchAll(importPattern)) {
      const full = match[1].trim();
      const name = match[2]?.trim() ?? lastSegment(full, ".");
      if (name && !name.includes(".")) map.set(name, full);
    }
    return map;
  },

  extractRoutes(source: string, path: string): CodeGraphNode[] {
    const classRouteMatch =
      source.match(/@RequestMapping\([\s\S]*?(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/) ??
      undefined;
    const classRoute = classRouteMatch?.[1];
    const routes: CodeGraphNode[] = [];

    for (const match of source.matchAll(
      /@RequestMapping\([\s\S]*?(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/g,
    )) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const name = match[1];
      routes.push({
        id: nodeId("route", `${path}:${name}`),
        type: "route",
        name,
        path,
        language: "java",
        line,
      });
    }

    for (const match of source.matchAll(
      /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\([\s\S]*?(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/g,
    )) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const name = joinRoute(classRoute, match[2]);
      routes.push({
        id: nodeId("route", `${path}:${name}`),
        type: "route",
        name,
        path,
        language: "java",
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

    // extends
    for (const match of source.matchAll(
      /(?:class|interface)\s+([A-Za-z_$][\w$]*).*?extends\s+([A-Za-z_$][\w$]*)/g,
    )) {
      pushNamedEdges(edges, "extends", match[1], match[2], symbolByName);
    }

    // implements
    for (const match of source.matchAll(
      /class\s+([A-Za-z_$][\w$]*)(?:[^{]*?\bextends\s+[A-Za-z_$][\w$]*)?\s+implements\s+([\w$,\s<>[\]]+?)(?:\s*\{|$)/gm,
    )) {
      const className = match[1];
      const rawList = match[2];
      const stripped = rawList.replace(/<[^>]*>/g, "");
      for (const iface of stripped.split(",")) {
        const ifaceName = iface.trim();
        if (ifaceName) pushNamedEdges(edges, "implements", className, ifaceName, symbolByName);
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
