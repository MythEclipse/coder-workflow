import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeEdges, edge } from "../ids.js";
import { getParser } from "../parsers/index.js";

const EXCLUDED_QUALIFIERS = new Set([
  "console",
  "Math",
  "JSON",
  "process",
  "window",
  "document",
  "global",
  "System",
  "out",
  "err",
  "fmt",
  "log",
  "logging",
  "sys",
  "os",
  "io",
  "time",
  "path",
  "fs",
]);

export function extractCallEdges(
  source: string,
  symbols: CodeGraphNode[],
  symbolByName: Map<string, CodeGraphNode[]>,
  importMap: Map<string, string>,
  filePath: string,
): CodeGraphEdge[] {
  const edges: CodeGraphEdge[] = [];
  const language = symbols[0]?.language ?? "javascript";

  for (const symbol of symbols) {
    const body = getExclusiveSymbolBody(source, symbol, symbols);
    const parser = getParser(language);
    const sanitizedBody = parser ? parser.sanitize(body) : body;

    const callPattern = /\b([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\(/g;

    for (const match of sanitizedBody.matchAll(callPattern)) {
      let name = match[1];
      let qualifier: string | undefined;

      if (match[2]) {
        qualifier = match[1];
        name = match[2];
        if (["this", "self", "super"].includes(qualifier)) {
          qualifier = undefined;
        }
      }

      if (
        [
          "if",
          "for",
          "while",
          "switch",
          "return",
          "func",
          "fn",
          "catch",
          "await",
          "import",
          "require",
          "super",
          "this",
        ].includes(name)
      )
        continue;
      if (
        qualifier &&
        [
          "if",
          "for",
          "while",
          "switch",
          "return",
          "func",
          "fn",
          "catch",
          "await",
          "import",
          "require",
          "super",
          "this",
        ].includes(qualifier)
      )
        continue;
      if (name === symbol.name) continue;

      const candidates = symbolByName.get(name) ?? [];
      let resolvedTargets: CodeGraphNode[] = [];

      if (qualifier) {
        const importedModule = importMap.get(qualifier);
        if (importedModule) {
          const parser = getParser(language);
          resolvedTargets = candidates.filter((c) =>
            parser ? parser.matchImport(importedModule, c.path, filePath) : false,
          );
        }
      } else {
        const localTarget = candidates.find((c) => c.path === filePath);
        if (localTarget) {
          resolvedTargets = [localTarget];
        } else {
          const importedModule = importMap.get(name);
          if (importedModule) {
            const parser = getParser(language);
            resolvedTargets = candidates.filter((c) =>
              parser ? parser.matchImport(importedModule, c.path, filePath) : false,
            );
          }
        }
      }

      if (resolvedTargets.length === 0 && (!qualifier || !EXCLUDED_QUALIFIERS.has(qualifier))) {
        resolvedTargets = candidates;
      }

      for (const target of resolvedTargets) {
        if (target.id === symbol.id) continue;
        const callEdge = edge("calls", symbol.id, target.id, name);
        callEdge.confidence = resolvedTargets.length === 1 ? 1 : 0.4;
        callEdge.resolution = resolvedTargets.length === 1 ? "unique-name" : "ambiguous-name";
        callEdge.candidates = resolvedTargets.map((t) => t.id);
        edges.push(callEdge);
      }
    }
  }

  return dedupeEdges(edges);
}

function getExclusiveSymbolBody(
  source: string,
  symbol: CodeGraphNode,
  allSymbolsInFile: CodeGraphNode[],
): string {
  const startLine = symbol.startLine ?? symbol.line ?? 1;
  const endLine = symbol.endLine ?? startLine;
  const start = lineOffset(source, startLine);
  const end = lineOffset(source, endLine + 1);
  let body = source.slice(start, end);

  const descendants = allSymbolsInFile.filter((candidate) => {
    if (candidate.id === symbol.id) return false;
    if (candidate.startLine === undefined || candidate.endLine === undefined) return false;
    return candidate.startLine >= startLine && candidate.endLine <= endLine;
  });

  descendants.sort((a, b) => (b.startLine ?? 0) - (a.startLine ?? 0));

  for (const desc of descendants) {
    const descStart = lineOffset(source, desc.startLine ?? 1) - start;
    const descEnd = lineOffset(source, (desc.endLine ?? 1) + 1) - start;
    if (descStart >= 0 && descEnd <= body.length && descStart < descEnd) {
      const before = body.slice(0, descStart);
      const masked = body.slice(descStart, descEnd).replace(/[^\n]/g, " ");
      const after = body.slice(descEnd);
      body = before + masked + after;
    }
  }

  return body;
}

function lineOffset(source: string, line: number): number {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
  }
  return offset;
}
