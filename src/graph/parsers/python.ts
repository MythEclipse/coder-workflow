import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeById, edge, nodeId } from "../ids.js";
import type { LanguageParser } from "./LanguageParser.js";
import type { LineRange } from "./utils.js";
import { controlFlowKeywords, hasLine, replaceWithSpaces } from "./utils.js";

function stripPythonComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("#");
      return commentIdx === -1 ? line : line.slice(0, commentIdx);
    })
    .join("\n");
}

export const pythonParser: LanguageParser = {
  language: "python",

  sanitize(source: string): string {
    let result = source;
    result = replaceWithSpaces(result, /#.*$/gm);
    result = replaceWithSpaces(result, /'''[\s\S]*?'''/g);
    result = replaceWithSpaces(result, /"""[\s\S]*?"""/g);
    result = replaceWithSpaces(result, /"([^"\\]|\\.)*"/g);
    result = replaceWithSpaces(result, /'([^'\\]|\\.)*'/g);
    return result;
  },

  extractSymbols(source: string, path: string): CodeGraphNode[] {
    const patterns = [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, /^\s*class\s+([A-Za-z_]\w*)/gm];
    const nodes: CodeGraphNode[] = [];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const name = match[1];
        if (controlFlowKeywords.has(name)) continue;
        const matchOffset = match[0].indexOf(name);
        const actualIndex = (match.index ?? 0) + (matchOffset >= 0 ? matchOffset : 0);
        const line = source.slice(0, actualIndex).split("\n").length;
        nodes.push({
          id: nodeId("symbol", `${path}:${name}`),
          type: match[0].trimStart().startsWith("class") ? "class" : "function",
          name,
          path,
          language: "python",
          line,
        });
      }
    }
    return dedupeById(nodes);
  },

  extractImports(source: string): string[] {
    const uncommented = stripPythonComments(source);
    const imports: string[] = [];
    const patterns = [/^import\s+([\w.]+)/gm, /^from\s+([\w.]+)\s+import/gm];
    for (const pattern of patterns) {
      for (const match of uncommented.matchAll(pattern)) {
        imports.push(match[1].trim());
      }
    }
    return [...new Set(imports)];
  },

  parseImports(source: string): Map<string, string> {
    const uncommented = stripPythonComments(source);
    const map = new Map<string, string>();
    const patterns = [
      /^[ \t]*import[ \t]+([\w., \t]+)/gm,
      /^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+([\w., \t*]+)/gm,
    ];

    for (const match of uncommented.matchAll(patterns[0])) {
      for (const imp of match[1].split(",")) {
        const parts = imp.trim().split(/\s+as\s+/);
        const full = parts[0];
        const alias = parts.length > 1 ? parts[1] : full.split(".").pop();
        if (alias) map.set(alias, full);
      }
    }

    for (const match of uncommented.matchAll(patterns[1])) {
      const full = match[1].trim();
      const imported = match[2];
      if (imported.trim() === "*") continue;
      for (const imp of imported.split(",")) {
        const parts = imp.trim().split(/\s+as\s+/);
        const importedItem = parts[0];
        const alias = parts.length > 1 ? parts[1] : importedItem;
        if (alias) map.set(alias, `${full}.${importedItem}`);
      }
    }
    return map;
  },

  extractRoutes(source: string, path: string): CodeGraphNode[] {
    const routes: CodeGraphNode[] = [];
    const pattern = /^\s*@[\w.]*\.(?:get|post|put|patch|delete|route)\(["']([^"']+)["']/gm;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      routes.push({
        id: nodeId("route", `${path}:${match[1]}`),
        type: "route",
        name: match[1],
        path,
        language: "python",
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
    const classByName = new Map(
      symbols.filter((symbol) => symbol.type === "class").map((symbol) => [symbol.name, symbol]),
    );

    for (const match of source.matchAll(/^\s*class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)) {
      const sourceSymbol = classByName.get(match[1]);
      if (!sourceSymbol) continue;
      for (const baseName of match[2]
        .split(",")
        .map((base) => base.trim().split(".").pop() ?? "")) {
        const targetSymbol = classByName.get(baseName) ?? symbolByName.get(baseName)?.[0];
        if (targetSymbol) edges.push(edge("extends", sourceSymbol.id, targetSymbol.id, baseName));
      }
    }

    return dedupeById(edges);
  },

  resolveSymbolRanges(
    source: string,
    symbols: CodeGraphNode[],
  ): Map<string, { startLine: number; endLine: number }> {
    const lines = source.split("\n");
    const lineIndents = lines.map((line) => {
      if (line.trim().length === 0 || line.trim().startsWith("#")) return -1;
      const match = line.match(/^(\s*)/);
      return match ? match[1].length : 0;
    });

    const ranges = new Map<string, LineRange>();

    for (const symbol of symbols) {
      if (!hasLine(symbol)) continue;

      const startIdx = symbol.line - 1;
      if (startIdx < 0 || startIdx >= lines.length) continue;

      const declLine = lines[startIdx];
      const declIndentMatch = declLine.match(/^(\s*)/);
      const declIndent = declIndentMatch ? declIndentMatch[1].length : 0;

      let endLine = symbol.line;
      for (let i = startIdx + 1; i < lines.length; i++) {
        const indent = lineIndents[i];
        if (indent === -1) {
          endLine = i + 1;
          continue;
        }
        if (indent <= declIndent) break;
        endLine = i + 1;
      }
      ranges.set(symbol.id, { startLine: symbol.line, endLine });
    }

    return ranges;
  },

  resolveImportTarget(
    imported: string,
    _sourcePath: string,
    filePaths: Set<string>,
  ): string | undefined {
    const importSlash = imported.replace(/\./g, "/");
    for (const ext of [".py"]) {
      const direct = `${importSlash}${ext}`;
      for (const fp of filePaths) {
        if (fp === direct || fp.endsWith(`/${direct}`)) return fp;
      }
    }
    return undefined;
  },

  matchImport(imported: string, targetPath: string, _sourcePath?: string): boolean {
    const targetClean = targetPath.replace(/\.py$/, "");
    const targetNormalized = targetClean.replace(/\\/g, "/");
    let importNormalized = imported.replace(/\\/g, "/");
    importNormalized = importNormalized.replace(/^(\.\/|\.\.\/)+/, "");
    importNormalized = importNormalized.replace(/\.py$/, "");
    const importSlash = importNormalized.replace(/\./g, "/");
    return targetNormalized.endsWith(importSlash);
  },
};
