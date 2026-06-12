import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";

export interface LanguageParser {
  /** The language identifier (e.g. "java", "python") */
  language: string;

  /** Removes comments and strings to prevent false positives in regexes */
  sanitize(source: string): string;

  /** Extracts classes, functions, structs, traits, enums, etc. */
  extractSymbols(source: string, path: string): Promise<CodeGraphNode[]> | CodeGraphNode[];

  /** Extracts raw import strings */
  extractImports(source: string): Promise<string[]> | string[];

  /** Maps local symbol names to their fully qualified imported names */
  parseImports(source: string): Promise<Map<string, string>> | Map<string, string>;

  /** Extracts API routes (@RequestMapping, get("/path"), etc.) */
  extractRoutes(source: string, path: string): Promise<CodeGraphNode[]> | CodeGraphNode[];

  /** Extracts extends, implements, trait impls, etc. */
  extractRelationshipEdges(
    source: string,
    symbols: CodeGraphNode[],
    symbolByName: Map<string, CodeGraphNode[]>,
  ): Promise<CodeGraphEdge[]> | CodeGraphEdge[];

  /** Maps symbols to their starting and ending lines for lexical scoping */
  resolveSymbolRanges(
    source: string,
    symbols: CodeGraphNode[],
  ): Promise<Map<string, { startLine: number; endLine: number }>> | Map<string, { startLine: number; endLine: number }>;

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
  ): Promise<string | undefined> | string | undefined;

  /** Determines if an import target matches a scanned file (for call edge resolution) */
  matchImport(imported: string, targetPath: string, sourcePath?: string): boolean;
}
