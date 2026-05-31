import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { stat as fsStat, readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, join, relative } from "node:path";
import {
  graphDbExists,
  readGraphFromDb,
  readScanCache,
  type ScanCacheEntry,
  writeGraphToDb,
  writeScanCache,
} from "./graph/db.js";
import {
  extractCallEdges,
  extractComponentUsageEdges,
  extractRouteHandlerEdges,
} from "./graph/edges.js";
import { listSourceFiles } from "./graph/files.js";
import { dedupeEdges, edge, groupByName, nodeId } from "./graph/ids.js";
import { languageForPath } from "./graph/languages.js";
import { getParser } from "./graph/parsers/index.js";
import { loadWorkspaceResolutionContext } from "./graph/workspaces.js";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode, CodeGraphSettings } from "./types.js";

interface ScanCache {
  files: Record<string, ScanCacheEntry>;
}

interface ParsedFileData {
  entry: ScanCacheEntry;
  source: string;
  sanitized: string;
  symbols: CodeGraphNode[];
}

const scannerVersion = "3";

function getFileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function loadCache(root: string): ScanCache {
  return readScanCache(root);
}

function saveCache(root: string, cache: ScanCache): void {
  writeScanCache(root, cache);
}

function isReusableCacheEntry(
  entry: ScanCacheEntry | undefined,
  hash: string | undefined,
  mtime: number,
  size: number,
  language: string,
): entry is ScanCacheEntry {
  if (!entry) return false;
  if (entry.scannerVersion !== scannerVersion) return false;
  if (entry.language !== language) return false;
  if (entry.size !== size) return false;
  if (entry.mtime !== mtime) return false;
  if (hash !== undefined && entry.hash !== hash) return false;
  return true;
}

function parseFile(
  rel: string,
  file: string,
  language: string,
  source: string,
  mtime: number,
  size: number,
  settings: CodeGraphSettings,
): ParsedFileData {
  settings.onParseFile?.(rel);

  const fileNodeId = nodeId("file", rel);
  const fileNodes: CodeGraphNode[] = [];
  const fileEdges: CodeGraphEdge[] = [];

  fileNodes.push({ id: fileNodeId, type: "file", name: basename(file), path: rel, language });

  const hash = getFileHash(source);
  let sanitized = source;
  let symbols: CodeGraphNode[] = [];

  const parser = getParser(language);
  if (parser) {
    sanitized = parser.sanitize(source);
    symbols = parser.extractSymbols(sanitized, rel);

    const symbolRanges = parser.resolveSymbolRanges(sanitized, symbols);
    for (const symbol of symbols) {
      const range = symbolRanges.get(symbol.id);
      if (range) {
        symbol.startLine = range.startLine;
        symbol.endLine = range.endLine;
      }
    }

    const routes = parser.extractRoutes(source, rel);
    for (const symbol of symbols) {
      fileNodes.push(symbol);
      fileEdges.push(edge("exports", fileNodeId, symbol.id, symbol.name));
    }
    for (const route of routes) {
      fileNodes.push(route);
      fileEdges.push(edge("exports", fileNodeId, route.id, route.name));
    }

    for (const imported of parser.extractImports(source)) {
      const importNodeId = nodeId("module", imported);
      fileNodes.push({ id: importNodeId, type: "module", name: imported, path: imported });
      fileEdges.push(edge("imports", fileNodeId, importNodeId, imported));
    }

    const importMap = parser.parseImports(source);

    return {
      entry: {
        hash,
        mtime,
        size,
        language,
        scannerVersion,
        nodes: fileNodes,
        localEdges: fileEdges,
        importMapEntries: [...importMap.entries()],
      },
      source,
      sanitized,
      symbols,
    };
  } else {
    // Fallback for unsupported/unknown languages
    return {
      entry: {
        hash,
        mtime,
        size,
        language,
        scannerVersion,
        nodes: fileNodes,
        localEdges: fileEdges,
        importMapEntries: [],
      },
      source,
      sanitized,
      symbols,
    };
  }
}

export async function scanCodebase(root: string, settings: CodeGraphSettings): Promise<CodeGraph> {
  const files = listSourceFiles(root, settings);
  const cache = loadCache(root);
  const workspaceContext = loadWorkspaceResolutionContext(root);

  // Phase 1: Parallel I/O with bounded concurrency
  const maxWorkers = Math.min(16, availableParallelism());
  const results = await boundedMap(files, maxWorkers, async (file) => {
    const rel = relative(root, file);
    const language = languageForPath(file) ?? "unknown";

    const fstat = await fsStat(file);
    const mtime = fstat.mtimeMs;
    const size = fstat.size;

    const cached = cache.files[rel];

    // Read file
    const source = await readFile(file, "utf8");
    const hash = getFileHash(source);

    // Hash-based reuse
    if (isReusableCacheEntry(cached, hash, mtime, size, language)) {
      return { rel, language, source, cached };
    }

    // Cache miss — parse
    const parsed = parseFile(rel, file, language, source, mtime, size, settings);
    return { rel, language, source, cached: parsed.entry, parsed };
  });

  // Phase 2: Sequential collect into shared structures (no races)
  const nodes: CodeGraphNode[] = [];
  const edges: CodeGraphEdge[] = [];
  const newCacheFiles: Record<string, ScanCacheEntry> = {};
  const sources: Array<{
    path: string;
    language: string;
    source: string;
    sanitized: string;
    symbols: CodeGraphNode[];
    importMap: Map<string, string>;
  }> = [];

  for (const r of results) {
    const entry = r.cached;
    newCacheFiles[r.rel] = entry;

    for (const node of entry.nodes) {
      if (!nodes.some((n) => n.id === node.id)) {
        nodes.push(node);
      }
    }
    edges.push(...entry.localEdges);

    const source = r.source!;
    const parser = getParser(r.language);
    const sanitized = parser ? parser.sanitize(source) : source;
    const symbols = entry.nodes.filter(
      (n) => n.type === "function" || n.type === "class" || n.type === "method",
    );

    sources.push({
      path: r.rel,
      language: r.language,
      source,
      sanitized,
      symbols,
      importMap: new Map(entry.importMapEntries),
    });
  }

  saveCache(root, { files: newCacheFiles });

  // Phase 3: Resolve depends-on edges
  const filePaths = new Set(nodes.filter((node) => node.type === "file").map((node) => node.path));
  for (const item of sources) {
    const parser = getParser(item.language);
    if (!parser) continue;
    for (const imported of new Set(item.importMap.values())) {
      const targetPath = parser.resolveImportTarget(imported, item.path, filePaths, {
        packages: workspaceContext.packages,
        root,
        pathAliases: workspaceContext.pathAliases,
      });
      if (targetPath) {
        edges.push(
          edge("depends-on", nodeId("file", item.path), nodeId("file", targetPath), imported),
        );
      }
    }
  }

  // Phase 4: Extract call/route/component edges
  const symbolByName = groupByName(
    nodes.filter((node) => node.type !== "file" && node.type !== "module"),
  );
  for (const item of sources) {
    const parser = getParser(item.language);
    edges.push(
      ...extractCallEdges(item.source, item.symbols, symbolByName, item.importMap, item.path),
    );
    if (parser) {
      edges.push(...parser.extractRelationshipEdges(item.sanitized, item.symbols, symbolByName));
    }
    edges.push(...extractRouteHandlerEdges(item.source, item.path, symbolByName));
    edges.push(...extractComponentUsageEdges(item.sanitized, item.symbols, symbolByName));
  }

  const metadata = buildGraphMetadata(nodes, edges, files, settings);

  return {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    root,
    nodes,
    edges: dedupeEdges(edges),
    metadata,
  };
}

async function boundedMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        console.error(`[scan] Error processing item ${i}:`, err);
        results[i] = undefined as R;
      }
    }
  });
  await Promise.all(workers);
  return results as R[];
}

function buildGraphMetadata(
  nodes: CodeGraphNode[],
  edges: CodeGraphEdge[],
  files: string[],
  settings: CodeGraphSettings,
): CodeGraph["metadata"] {
  const nodeTypes: NonNullable<CodeGraph["metadata"]["nodeTypes"]> = {};
  const edgeTypes: NonNullable<CodeGraph["metadata"]["edgeTypes"]> = {};
  for (const node of nodes) nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
  for (const edgeItem of edges) edgeTypes[edgeItem.type] = (edgeTypes[edgeItem.type] ?? 0) + 1;

  const filePaths = new Set(nodes.filter((node) => node.type === "file").map((node) => node.path));
  const relatedFiles = new Set<string>();

  const nodePaths = new Map<string, string>();
  for (const node of nodes) {
    if (node.path) nodePaths.set(node.id, node.path);
  }

  const getPath = (id: string) => {
    if (id.startsWith("file:")) return id.slice("file:".length);
    return nodePaths.get(id);
  };

  for (const edgeItem of edges) {
    if (edgeItem.type === "exports") continue;
    const sourcePath = getPath(edgeItem.source);
    const targetPath = getPath(edgeItem.target);
    if (sourcePath && filePaths.has(sourcePath)) relatedFiles.add(sourcePath);
    if (targetPath && filePaths.has(targetPath)) relatedFiles.add(targetPath);
  }

  const relationshipCoverage = filePaths.size === 0 ? 1 : relatedFiles.size / filePaths.size;
  const unresolvedLocalImports = edges.filter(
    (edgeItem) => edgeItem.type === "imports" && edgeItem.target.startsWith("module:../"),
  ).length;
  const isolatedPenalty = filePaths.size === 0 ? 0 : 1 - relationshipCoverage;
  const unresolvedPenalty = edges.length === 0 ? 0 : unresolvedLocalImports / edges.length;
  const qualityScore = Math.max(
    0,
    Math.min(1, 1 - isolatedPenalty * 0.6 - unresolvedPenalty * 0.4),
  );

  return {
    languages: [...new Set(files.map((file) => languageForPath(file)).filter(Boolean) as string[])],
    filesScanned: files.length,
    ignoredPaths: settings.ignorePaths,
    nodesCount: nodes.length,
    edgesCount: edges.length,
    nodeTypes,
    edgeTypes,
    relationshipCoverage,
    qualityScore,
  };
}

export function writeGraph(root: string, graph: CodeGraph): void {
  const dir = join(root, ".codegraph");
  mkdirSync(join(dir, "exports"), { recursive: true });
  mkdirSync(join(dir, "ui"), { recursive: true });
  writeGraphToDb(root, graph);
}

export function readGraph(root: string): CodeGraph {
  return readGraphFromDb(root);
}

export function graphExists(root: string): boolean {
  return graphDbExists(root);
}
