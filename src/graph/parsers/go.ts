import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeById, dedupeEdges, nodeId } from "../ids.js";
import type { LanguageParser } from "./LanguageParser.js";
import {
  controlFlowKeywords,
  defaultResolveSymbolRanges,
  lastSegment,
  sanitizeBraceLanguage,
} from "./utils.js";

export const goParser: LanguageParser = {
  language: "go",

  sanitize(source: string): string {
    return sanitizeBraceLanguage(source);
  },

  extractSymbols(source: string, path: string): CodeGraphNode[] {
    const patterns = [
      /^\s*type\s+([A-Za-z_]\w*)\s+(?:interface|struct)/gm,
      /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm,
    ];
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
          type:
            match[0].includes("struct") || match[0].includes("interface") ? "class" : "function",
          name,
          path,
          language: "go",
          line,
        });
      }
    }
    return dedupeById(nodes);
  },

  extractImports(source: string): string[] {
    const uncommented = source
      .split("\n")
      .map((line) => {
        const commentIdx = line.indexOf("//");
        return commentIdx === -1 ? line : line.slice(0, commentIdx);
      })
      .join("\n");

    const imports = [...uncommented.matchAll(/import\s+"([^"]+)"/g)].map((match) => match[1]);
    for (const block of uncommented.matchAll(/import\s*\(([\s\S]*?)\)/g)) {
      imports.push(...[...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    }
    return [...new Set(imports)];
  },

  parseImports(source: string): Map<string, string> {
    const uncommented = source
      .split("\n")
      .map((line) => {
        const commentIdx = line.indexOf("//");
        return commentIdx === -1 ? line : line.slice(0, commentIdx);
      })
      .join("\n");

    const map = new Map<string, string>();
    const singlePattern = /import\s+"([^"]+)"/g;
    for (const match of uncommented.matchAll(singlePattern)) {
      const full = match[1].trim();
      const short = lastSegment(full, "/");
      map.set(short, full);
    }
    const blockPattern = /import\s*\(([\s\S]*?)\)/g;
    for (const block of uncommented.matchAll(blockPattern)) {
      for (const match of block[1].matchAll(/"([^"]+)"/g)) {
        const full = match[1].trim();
        // Allow named imports: `alias "pkg/path"`
        const precedingAliasMatch = match.input
          ?.substring(0, match.index)
          .match(/([A-Za-z_.][\w]*)\s*$/);
        const alias = precedingAliasMatch ? precedingAliasMatch[1] : lastSegment(full, "/");
        map.set(alias, full);
      }
    }
    return map;
  },

  extractRoutes(source: string, path: string): CodeGraphNode[] {
    const routes: CodeGraphNode[] = [];
    const pattern =
      /(?:app|router|http)\.(?:get|post|put|patch|delete|HandleFunc|Handle)\(["']([^"']+)["']/g;

    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      routes.push({
        id: nodeId("route", `${path}:${match[1]}`),
        type: "route",
        name: match[1],
        path,
        language: "go",
        line,
      });
    }
    return dedupeById(routes);
  },

  extractRelationshipEdges(
    _source: string,
    _symbols: CodeGraphNode[],
    _symbolByName: Map<string, CodeGraphNode[]>,
  ): CodeGraphEdge[] {
    // Go does not have explicit "implements" declarations (structural typing)
    return [];
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
    // Go resolves globally based on GOPATH/module roots, not easily relatively
    // We try to match the imported package against directory paths
    for (const candidate of filePaths) {
      if (candidate.endsWith(".go")) {
        const dir = candidate.split("/").slice(0, -1).join("/");
        if (dir.endsWith(imported) || imported.endsWith(dir)) return candidate;
      }
    }
    return undefined;
  },

  matchImport(imported: string, targetPath: string, sourcePath?: string): boolean {
    const targetClean = targetPath.replace(/\.go$/, "");
    const targetNormalized = targetClean.replace(/\\/g, "/");

    let importNormalized = imported.replace(/\\/g, "/");
    importNormalized = importNormalized.replace(/^(\.\/|\.\.\/)+/, "");
    importNormalized = importNormalized.replace(/\.go$/, "");

    const parts = targetNormalized.split("/");
    parts.pop(); // Remove file name, keep dir
    const targetDir = parts.join("/");
    return targetDir.endsWith(importNormalized) || importNormalized.endsWith(targetDir);
  },
};
