import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";

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

// ─── Graph read/write (JSON, atomic via tmp + rename) ──────────────────

export async function writeGraphToDb(root: string, graph: CodeGraph): Promise<void> {
  validateGraphIntegrity(graph);
  const dir = join(root, ".codegraph");
  mkdirSync(dir, { recursive: true });

  // Migrate: if old DB file exists, back it up so the JSON replaces it cleanly
  const oldDbPath = join(dir, "graph.db");
  if (existsSync(oldDbPath)) {
    const backupPath = join(dir, "graph.db.migrated-" + Date.now());
    try {
      renameSync(oldDbPath, backupPath);
    } catch {
      // best-effort; user can clean up manually
    }
    // Also clean up WAL/SHM sidecars
    for (const ext of ["-wal", "-shm"]) {
      const sidecar = oldDbPath + ext;
      if (existsSync(sidecar)) {
        try {
          renameSync(sidecar, backupPath + ext);
        } catch {
          /* ignore */
        }
      }
    }
  }

  const tmpPath = join(dir, `graph.tmp.${process.pid}.json`);
  const finalPath = graphDbPath(root);

  // Atomic write: write to tmp, then rename
  writeFileSync(tmpPath, JSON.stringify(graph), "utf8");
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
      metadata: {
        languages: [],
        filesScanned: 0,
        ignoredPaths: [],
      },
    };
  }
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as CodeGraph;
}

// ─── Scan cache (JSON, atomic) ─────────────────────────────────────────

export async function readScanCache(root: string): Promise<ScanCacheData> {
  const path = scanCachePath(root);
  if (!existsSync(path)) return { files: {} };
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as ScanCacheData;
  } catch {
    return { files: {} };
  }
}

export async function writeScanCache(root: string, cache: ScanCacheData): Promise<void> {
  const dir = join(root, ".codegraph");
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `scan-cache.tmp.${process.pid}.json`);
  const finalPath = scanCachePath(root);

  writeFileSync(tmpPath, JSON.stringify(cache), "utf8");
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
  // Read all existing nodes/edges from JSON
  const existing = await readGraphFromDb(root);

  // Find all node IDs whose path matches one of the replaced paths
  const pathSet = new Set(paths);
  const removedNodeIds = new Set(
    existing.nodes.filter((node) => pathSet.has(node.path)).map((node) => node.id),
  );

  // Preserve nodes/edges not touching the replaced paths
  const preservedNodes = existing.nodes.filter((node) => !pathSet.has(node.path));
  const preservedEdges = existing.edges.filter(
    (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
  );

  const finalNodes = [...preservedNodes, ...replacementNodes];

  // Validate replacement edges against final node set
  const finalNodeIds = new Set(finalNodes.map((node) => node.id));
  for (const edge of replacementEdges) {
    if (!finalNodeIds.has(edge.source)) {
      throw new Error(`Graph edge ${edge.id} references missing source ${edge.source}`);
    }
    if (!finalNodeIds.has(edge.target)) {
      throw new Error(`Graph edge ${edge.id} references missing target ${edge.target}`);
    }
  }

  // Deduplicate edges
  const allEdges = [...preservedEdges, ...replacementEdges];
  const seen = new Set<string>();
  const finalEdges = allEdges.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const updated: CodeGraph = {
    ...existing,
    nodes: finalNodes,
    edges: finalEdges,
    metadata: {
      ...existing.metadata,
      nodesCount: finalNodes.length,
      edgesCount: finalEdges.length,
    },
  };

  await writeGraphToDb(root, updated);
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
