import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";

export interface LanguageParser {
  /** The language identifier (e.g. "java", "python") */
  language: string;

  /** Removes comments and strings to prevent false positives in regexes */
  sanitize(source: string): string;

  /** Extracts classes, functions, structs, traits, enums, etc. */
  extractSymbols(source: string, path: string): CodeGraphNode[];

  /** Extracts raw import strings */
  extractImports(source: string): string[];

  /** Maps local symbol names to their fully qualified imported names */
  parseImports(source: string): Map<string, string>;

  /** Extracts API routes (@RequestMapping, get("/path"), etc.) */
  extractRoutes(source: string, path: string): CodeGraphNode[];

  /** Extracts extends, implements, trait impls, etc. */
  extractRelationshipEdges(
    source: string,
    symbols: CodeGraphNode[],
    symbolByName: Map<string, CodeGraphNode[]>,
  ): CodeGraphEdge[];

  /** Maps symbols to their starting and ending lines for lexical scoping */
  resolveSymbolRanges(
    source: string,
    symbols: CodeGraphNode[],
  ): Map<string, { startLine: number; endLine: number }>;

  /** Resolves an imported module string to a local file path if it exists */
  resolveImportTarget(
    imported: string,
    sourcePath: string,
    filePaths: Set<string>,
    context?: {
      packages?: Map<string, string>;
      root?: string;
      pathAliases?: Array<{ prefix: string; targets: string[] }>;
    },
  ): string | undefined;

  /** Determines if an import target matches a scanned file (for call edge resolution) */
  matchImport(imported: string, targetPath: string, sourcePath?: string): boolean;
}
