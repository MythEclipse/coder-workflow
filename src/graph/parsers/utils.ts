import type { CodeGraphNode } from "../../types.js";

/** Replaces a regex match with spaces to preserve line numbers and string lengths */
export function replaceWithSpaces(source: string, pattern: RegExp): string {
  return source.replace(pattern, (match) => {
    const lines = match.split("\n");
    if (lines.length === 1) return " ".repeat(match.length);
    return lines.map((line) => " ".repeat(line.length)).join("\n");
  });
}

/** Extracts the last segment of a delimited string */
export function lastSegment(value: string, delimiter: string): string {
  const parts = value.split(delimiter);
  return parts[parts.length - 1] ?? value;
}

/** Joins a class-level route prefix with a method-level route */
export function joinRoute(prefix: string | undefined, route: string): string {
  if (!prefix) return route;
  if (prefix.endsWith("/") && route.startsWith("/")) return `${prefix}${route.slice(1)}`;
  if (!prefix.endsWith("/") && !route.startsWith("/")) return `${prefix}/${route}`;
  return `${prefix}${route}`;
}

export const controlFlowKeywords = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "catch",
  "finally",
  "try",
  "match",
  "select",
  "return",
  "throw",
  "throws",
  "break",
  "continue",
  "default",
]);

export interface LineRange {
  startLine: number;
  endLine: number;
}

export type SymbolWithLine = CodeGraphNode & { line: number };

export function hasLine(symbol: CodeGraphNode): symbol is SymbolWithLine {
  return typeof symbol.line === "number";
}

/** Resolves brace {} block ranges for brace-based languages (Java, JS, Go, Rust, etc.) */
export function resolveBraceRanges(sanitized: string): LineRange[] {
  const lines = sanitized.split("\n");
  const stack: { lineNum: number; charIndex: number }[] = [];
  const ranges: LineRange[] = [];

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === "{") {
        stack.push({ lineNum: l + 1, charIndex: c });
      } else if (char === "}") {
        const open = stack.pop();
        if (open) {
          ranges.push({ startLine: open.lineNum, endLine: l + 1 });
        }
      }
    }
  }
  return ranges;
}

/** Default implementation for brace-based symbol range resolution */
export function defaultResolveSymbolRanges(
  sanitized: string,
  symbols: CodeGraphNode[],
): Map<string, { startLine: number; endLine: number }> {
  const ranges = new Map<string, LineRange>();
  if (symbols.length === 0) return ranges;

  const ordered = [...symbols].filter(hasLine).sort((a, b) => a.line - b.line);
  const braceRanges = resolveBraceRanges(sanitized);

  for (let i = 0; i < ordered.length; i++) {
    const symbol = ordered[i];
    const sLine = symbol.line;
    const nextSymbol = ordered[i + 1];
    const maxStartLine = nextSymbol ? nextSymbol.line - 1 : Infinity;

    const candidates = braceRanges.filter(
      (r) => r.startLine >= sLine && r.startLine <= maxStartLine,
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.startLine - b.startLine);
      ranges.set(symbol.id, candidates[0]);
    } else {
      ranges.set(symbol.id, { startLine: sLine, endLine: sLine });
    }
  }

  return ranges;
}

/** Replaces common comment blocks and strings for brace languages */
export function sanitizeBraceLanguage(source: string): string {
  let result = source;
  result = replaceWithSpaces(result, /\/\*[\s\S]*?\*\//g);
  result = replaceWithSpaces(result, /\/\/.*$/gm);
  result = replaceWithSpaces(result, /`[\s\S]*?`/g);
  result = replaceWithSpaces(result, /"([^"\\]|\\.)*"/g);
  result = replaceWithSpaces(result, /'([^'\\]|\\.)*'/g);
  return result;
}

/** Resolves an import from an FQN (fully qualified name) to a path for Java/Kotlin */
export function resolveJavaKotlinPackageImport(
  fqn: string,
  filePaths: Set<string>,
  extensions: string[],
): string | undefined {
  const slashPath = fqn.replace(/\./g, "/");
  for (const ext of extensions) {
    const direct = `${slashPath}${ext}`;
    for (const fp of filePaths) {
      if (fp === direct || fp.endsWith(`/${direct}`)) return fp;
    }
  }
  return undefined;
}

/**
 * Resolves the byte offset in a source string for a given 1-based line number.
 * Returns 0 for line 1 (or earlier), and the start of the Nth line otherwise.
 * If the line is past the end of the source, returns `source.length`.
 */
export function lineOffset(source: string, line: number): number {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
  }
  return offset;
}
