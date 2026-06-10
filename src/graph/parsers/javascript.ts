import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeById, dedupeEdges, edge, nodeId } from "../ids.js";
import type { LanguageParser } from "./LanguageParser.js";
import { extractImportsFromAST, extractSymbolsFromAST } from "./typescript.js";
import { controlFlowKeywords, defaultResolveSymbolRanges, sanitizeBraceLanguage } from "./utils.js";

function createJsTsParser(language: "javascript" | "typescript"): LanguageParser {
  return {
    language,

    sanitize(source: string): string {
      return sanitizeBraceLanguage(source);
    },

    extractSymbols(source: string, path: string): CodeGraphNode[] {
      // Use AST extraction for TypeScript to avoid matching symbols in comments/strings
      if (language === "typescript") {
        return extractSymbolsFromAST(source, path);
      }

      // Fallback regex-based extraction for JavaScript
      const patterns = [
        /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
        /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
        /(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
        /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
        /(?:export\s+)?const\s+([A-Z][A-Za-z_$\d]*)\s*=/g,
        /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
        /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm,
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
              match[0].includes("class") || match[0].includes("interface") ? "class" : "function",
            name,
            path,
            language,
            line,
          });
        }
      }
      return dedupeById(nodes);
    },

    extractImports(source: string): string[] {
      // Use AST extraction for TypeScript to handle multiline/destructured imports
      if (language === "typescript") {
        return extractImportsFromAST(source);
      }

      // Fallback regex-based extraction for JavaScript
      const uncommented = source
        .split("\n")
        .map((line) => {
          const commentIdx = line.indexOf("//");
          return commentIdx === -1 ? line : line.slice(0, commentIdx);
        })
        .join("\n");

      const imports: string[] = [];
      const patterns = [
        /^import\s+.*?from\s+["']([^"']+)["']/gm,
        /^const\s+.*?=\s*require\(["']([^"']+)["']\)/gm,
      ];
      for (const pattern of patterns) {
        for (const match of uncommented.matchAll(pattern)) {
          imports.push(match[1].trim());
        }
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
      const patterns = [
        /^\s*import\s+(?:type\s+)?(?:([^,{]+)|.*?\{([^}]+)\})\s+from\s+["']([^"']+)["']/gm,
        /^\s*const\s+(?:([^,{]+)|.*?\{([^}]+)\})\s*=\s*require\(["']([^"']+)["']\)/gm,
      ];
      for (const pattern of patterns) {
        for (const match of uncommented.matchAll(pattern)) {
          const full = match[3].trim();
          if (match[1]) {
            // Default import: import Foo from 'foo'
            const alias = match[1]
              .trim()
              .split(/\s+as\s+/)
              .pop();
            if (alias) map.set(alias, full);
          }
          if (match[2]) {
            // Named imports: import { Foo, Bar as Baz } from 'foo'
            for (const item of match[2].split(",")) {
              const alias = item
                .trim()
                .split(/\s+as\s+/)
                .pop();
              if (alias) map.set(alias, full);
            }
          }
        }
      }
      return map;
    },

    extractRoutes(source: string, path: string): CodeGraphNode[] {
      const patterns = [
        /(?:app|router|http)\.(?:get|post|put|patch|delete|HandleFunc)\(["']([^"']+)["']/g,
        /@Controller\(["']([^"']+)["']\)/g,
      ];
      const routes: CodeGraphNode[] = [];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index ?? 0).split("\n").length;
          routes.push({
            id: nodeId("route", `${path}:${match[1]}`),
            type: "route",
            name: match[1],
            path,
            language,
            line,
          });
        }
      }
      return dedupeById(routes);
    },

    extractRelationshipEdges(
      source: string,
      symbols: CodeGraphNode[],
      symbolByName: Map<string, CodeGraphNode[]>,
    ): CodeGraphEdge[] {
      const edges: CodeGraphEdge[] = [];

      // class Foo extends Bar
      for (const match of source.matchAll(
        /(?:class|interface)\s+([A-Za-z_$][\w$]*).*?extends\s+([A-Za-z_$.][\w$.]*)/g,
      )) {
        for (const sourceNode of symbolByName.get(match[1]) ?? []) {
          for (const targetNode of symbolByName.get(match[2]) ?? []) {
            edges.push(edge("extends", sourceNode.id, targetNode.id, match[2]));
          }
        }
      }

      // class Foo implements Bar
      for (const match of source.matchAll(
        /class\s+([A-Za-z_$][\w$]*)(?:[^{]*?\bextends\s+[A-Za-z_$.][\w$.]*)?\s+implements\s+([\w$,\s<>[\]]+?)(?:\s*\{|$)/gm,
      )) {
        const className = match[1];
        const rawList = match[2].replace(/<[^>]*>/g, "");
        for (const iface of rawList.split(",")) {
          const ifaceName = iface.trim();
          if (ifaceName) {
            for (const sourceNode of symbolByName.get(className) ?? []) {
              for (const targetNode of symbolByName.get(ifaceName) ?? []) {
                edges.push(edge("implements", sourceNode.id, targetNode.id, ifaceName));
              }
            }
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
      const { packages: workspacePackages, root, pathAliases } = context ?? {};

      // Check workspace packages first
      if (workspacePackages && workspacePackages.has(imported) && root) {
        const packageRoot = workspacePackages.get(imported)!;
        const indexCandidates = [
          `${packageRoot}/src/index.ts`,
          `${packageRoot}/src/index.tsx`,
          `${packageRoot}/src/index.js`,
          `${packageRoot}/src/index.jsx`,
          `${packageRoot}/index.ts`,
          `${packageRoot}/index.tsx`,
          `${packageRoot}/index.js`,
          `${packageRoot}/index.jsx`,
        ];
        for (const candidate of indexCandidates) {
          // Convert absolute path to relative for comparison with filePaths
          const relativePath = (
            candidate.startsWith(root) ? candidate.slice(root.length + 1) : candidate
          ).replace(/\\/g, "/");
          if (filePaths.has(relativePath)) {
            return relativePath;
          }
        }
      }

      // Check path aliases
      if (pathAliases && root) {
        for (const alias of pathAliases) {
          if (!imported.startsWith(alias.prefix)) continue;
          const suffix = imported.slice(alias.prefix.length);
          for (const target of alias.targets) {
            const candidate = target.replace(/\*$/, suffix);
            // Normalize path and reject escapes
            const normalized = candidate.replace(/\\/g, "/");
            if (normalized.startsWith("..") || normalized.includes("/../")) continue;

            const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
            const sourceBase = normalized.replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/, "");
            const candidates = [
              normalized,
              sourceBase,
              ...extensions.map((ext) => `${sourceBase}${ext}`),
              ...extensions.map((ext) => `${sourceBase}/index${ext}`),
            ];
            const found = candidates.find((c) => filePaths.has(c));
            if (found) return found;
          }
        }
      }

      if (
        !imported.startsWith("./") &&
        !imported.startsWith("../") &&
        imported !== "." &&
        imported !== ".."
      )
        return undefined;

      const sourceDir = sourcePath.split("/").slice(0, -1);
      const resolved: string[] = [...sourceDir];
      for (const part of imported.split("/")) {
        if (part === "." || part === "") continue;
        if (part === "..") resolved.pop();
        else resolved.push(part);
      }

      const base = resolved.join("/");
      const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
      const sourceBase = base.replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/, "");

      const candidates = [
        base,
        sourceBase,
        ...extensions.map((ext) => `${sourceBase}${ext}`),
        ...extensions.map((ext) => `${sourceBase}/index${ext}`),
      ];

      return candidates.find((candidate) => filePaths.has(candidate));
    },

    matchImport(imported: string, targetPath: string, sourcePath?: string): boolean {
      if (sourcePath && (imported.startsWith("./") || imported.startsWith("../"))) {
        const sourceDir = sourcePath.replace(/\\/g, "/").split("/").slice(0, -1);
        const resolved: string[] = [...sourceDir];
        for (const part of imported.replace(/\\/g, "/").split("/")) {
          if (part === "." || part === "") continue;
          if (part === "..") resolved.pop();
          else resolved.push(part);
        }
        const cleanImport = resolved.join("/").replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/, "");
        const cleanTarget = targetPath
          .replace(/\\/g, "/")
          .replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/, "");
        return cleanTarget === cleanImport || cleanTarget === `${cleanImport}/index`;
      }

      const targetClean = targetPath.replace(/\.(ts|tsx|js|jsx)$/, "");
      const targetNormalized = targetClean.replace(/\\/g, "/");

      let importNormalized = imported.replace(/\\/g, "/");
      importNormalized = importNormalized.replace(/^(\.\/|\.\.\/)+/, "");
      importNormalized = importNormalized.replace(/\.(ts|tsx|js|jsx)$/, "");

      return targetNormalized.endsWith(importNormalized);
    },
  };
}

export const javascriptParser = createJsTsParser("javascript");
export const typescriptParser = createJsTsParser("typescript");
