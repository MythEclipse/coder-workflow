import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";

// ─── Types & Interfaces ──────────────────────────────────────────────────

export interface ScanCacheEntry {
  hash: string;
  mtime: number;
  size?: number;
  language?: string;
  scannerVersion: string;
  nodes: CodeGraphNode[];
  localEdges: CodeGraphEdge[];
  importMapEntries: [string, string][];
}

export interface ScanCacheData {
  files: Record<string, ScanCacheEntry>;
}

// ─── File paths ──────────────────────────────────────────────────────────

export function graphDbPath(root: string): string {
  return join(root, ".codegraph", "graph.json");
}

function scanCachePath(root: string): string {
  return join(root, ".codegraph", "scan-cache.json");
}

export async function graphDbExists(root: string): Promise<boolean> {
  return existsSync(graphDbPath(root));
}

// ─── Graph read/write ────────────────────────────────────────────────────

export async function writeGraphToDb(root: string, graph: CodeGraph): Promise<void> {
  validateGraphIntegrity(graph);
  
  const dir = join(root, ".codegraph");
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `graph.tmp.${process.pid}.json`);
  const finalPath = graphDbPath(root);

  writeFileSync(tmpPath, JSON.stringify(graph, null, 2), "utf8");
  renameSync(tmpPath, finalPath);
}

export async function readGraphFromDb(root: string): Promise<CodeGraph> {
  const path = graphDbPath(root);
  if (!existsSync(path)) {
    return {
      version: "0.1.0",
      generatedAt: new Date(0).toISOString(),
      root,
      nodes: [],
      edges: [],
      metadata: { languages: [], filesScanned: 0, ignoredPaths: [] },
    };
  }

  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch {
    return {
      version: "0.1.0",
      generatedAt: new Date(0).toISOString(),
      root,
      nodes: [],
      edges: [],
      metadata: { languages: [], filesScanned: 0, ignoredPaths: [] },
    };
  }
}

// ─── Scan cache (JSON, atomic) ─────────────────────────────────────────

export async function readScanCache(root: string): Promise<ScanCacheData> {
  const path = scanCachePath(root);
  if (!existsSync(path)) return { files: {} };
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch {
    return { files: {} };
  }
}

export async function writeScanCache(root: string, cache: ScanCacheData): Promise<void> {
  const dir = join(root, ".codegraph");
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `scan-cache.tmp.${process.pid}.json`);
  const finalPath = scanCachePath(root);

  writeFileSync(tmpPath, JSON.stringify(cache, null, 2), "utf8");
  renameSync(tmpPath, finalPath);
}

// ─── Path-scoped incremental replacement ───────────────────────────────

export async function replaceGraphPathsInDb(
  root: string,
  _graph: CodeGraph,
  paths: string[],
  replacementNodes: CodeGraphNode[],
  replacementEdges: CodeGraphEdge[],
): Promise<void> {
  const graph = await readGraphFromDb(root);

  const pathsSet = new Set(paths);

  // Filter out nodes and edges from old paths
  const keepNodes = graph.nodes.filter(n => !pathsSet.has(n.path));
  const keepNodesIds = new Set(keepNodes.map(n => n.id));

  // Add the replacement nodes
  for (const n of replacementNodes) {
    keepNodesIds.add(n.id);
  }

  // Filter out edges where source or target is being removed (and not replaced)
  const keepEdges = graph.edges.filter(e => {
    return keepNodesIds.has(e.source) && keepNodesIds.has(e.target);
  });

  graph.nodes = [...keepNodes, ...replacementNodes];
  graph.edges = [...keepEdges, ...replacementEdges];

  // Update count metadata
  if (graph.metadata) {
    graph.metadata.nodesCount = graph.nodes.length;
    graph.metadata.edgesCount = graph.edges.length;
  }

  await writeGraphToDb(root, graph);
}

// ─── Validation ──────────────────────────────────────────────────────────

function validateGraphIntegrity(graph: CodeGraph): void {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      throw new Error(`Graph edge ${edge.id} references missing source ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      throw new Error(`Graph edge ${edge.id} references missing target ${edge.target}`);
    }
  }
}

