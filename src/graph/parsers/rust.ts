import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeById, dedupeEdges, edge, nodeId } from "../ids.js";
import type { LanguageParser } from "./LanguageParser.js";
import {
  controlFlowKeywords,
  defaultResolveSymbolRanges,
  lastSegment,
  sanitizeBraceLanguage,
} from "./utils.js";

export const rustParser: LanguageParser = {
  language: "rust",

  sanitize(source: string): string {
    return sanitizeBraceLanguage(source);
  },

  extractSymbols(source: string, path: string): CodeGraphNode[] {
    const patterns = [
      /(?:pub\s+)?trait\s+([A-Za-z_]\w*)/g,
      /(?:pub\s+)?fn\s+([A-Za-z_]\w*)/g,
      /(?:pub\s+)?struct\s+([A-Za-z_]\w*)/g,
      /(?:pub\s+)?enum\s+([A-Za-z_]\w*)/g,
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
            match[0].includes("struct") || match[0].includes("enum") || match[0].includes("trait")
              ? "class"
              : "function",
          name,
          path,
          language: "rust",
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

    const imports: string[] = [];
    for (const match of uncommented.matchAll(/use\s+([^;]+);/g)) {
      imports.push(match[1].trim());
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
    for (const match of uncommented.matchAll(/use\s+([^;]+);/g)) {
      const full = match[1].trim();
      if (full.includes("{")) {
        // use std::collections::{HashMap, HashSet};
        const prefixMatch = full.match(/^(.*?)::\s*\{/);
        const prefix = prefixMatch ? prefixMatch[1].replace(/\s/g, "") : "";
        const blockMatch = full.match(/\{([^}]+)\}/);
        if (blockMatch) {
          for (const item of blockMatch[1].split(",")) {
            const aliasParts = item.split(/\s+as\s+/);
            const rawName = aliasParts[0].trim();
            const aliasName = aliasParts.length > 1 ? aliasParts[1].trim() : rawName;
            if (aliasName) map.set(aliasName, `${prefix}::${rawName}`);
          }
        }
      } else {
        const aliasParts = full.split(/\s+as\s+/);
        const rawName = aliasParts[0].replace(/\s/g, "");
        const aliasName = aliasParts.length > 1 ? aliasParts[1].trim() : lastSegment(rawName, "::");
        if (aliasName) map.set(aliasName, rawName);
      }
    }
    return map;
  },

  extractRoutes(source: string, path: string): CodeGraphNode[] {
    // Rust doesn't have a single dominant route framework syntax like Python/Java/JS
    // so we skip for now, matching the original implementation.
    return [];
  },

  extractRelationshipEdges(
    source: string,
    symbols: CodeGraphNode[],
    symbolByName: Map<string, CodeGraphNode[]>,
  ): CodeGraphEdge[] {
    const edges: CodeGraphEdge[] = [];
    for (const match of source.matchAll(/impl\s+([A-Za-z_][\w:]*)\s+for\s+([A-Za-z_]\w*)/g)) {
      const traitNameMatch = match[1];
      const traitName = lastSegment(traitNameMatch, "::");
      const structName = match[2];
      for (const sourceNode of symbolByName.get(structName) ?? []) {
        for (const targetNode of symbolByName.get(traitName) ?? []) {
          edges.push(edge("implements", sourceNode.id, targetNode.id, traitName));
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
    const importSlash = imported.replace(/::/g, "/").replace(/^crate\//, "src/");
    for (const ext of [".rs"]) {
      const direct = `${importSlash}${ext}`;
      for (const fp of filePaths) {
        if (fp === direct || fp.endsWith(`/${direct}`)) return fp;
      }
    }
    return undefined;
  },

  matchImport(imported: string, targetPath: string, sourcePath?: string): boolean {
    const targetClean = targetPath.replace(/\.rs$/, "");
    const targetNormalized = targetClean.replace(/\\/g, "/");

    let importNormalized = imported.replace(/\\/g, "/");
    importNormalized = importNormalized.replace(/^(\.\/|\.\.\/)+/, "");
    importNormalized = importNormalized.replace(/\.rs$/, "");

    const importSlash = importNormalized.replace(/::/g, "/").replace(/^crate\//, "src/");
    const parentSlash = importSlash.substring(0, importSlash.lastIndexOf("/"));
    const targetWithoutMod = targetNormalized.replace(/\/mod$/, "");

    return (
      targetNormalized.endsWith(importSlash) ||
      targetNormalized.endsWith(parentSlash) ||
      parentSlash.endsWith(targetNormalized) ||
      targetWithoutMod.endsWith(parentSlash) ||
      parentSlash.endsWith(targetWithoutMod)
    );
  },
};
