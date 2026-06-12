import { existsSync, mkdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  return join(root, ".codegraph", "graph.db");
}

function scanCachePath(root: string): string {
  return join(root, ".codegraph", "scan-cache.json");
}

export async function graphDbExists(root: string): Promise<boolean> {
  return existsSync(graphDbPath(root));
}

// ─── SQLite Integration ──────────────────────────────────────────────────

function getDb(root: string): DatabaseSync {
  const dir = join(root, ".codegraph");
  mkdirSync(dir, { recursive: true });
  const dbPath = graphDbPath(root);
  const db = new DatabaseSync(dbPath);

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT,
      name TEXT,
      path TEXT,
      language TEXT,
      line INTEGER,
      startLine INTEGER,
      endLine INTEGER,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      type TEXT,
      source TEXT,
      target TEXT,
      evidence TEXT,
      confidence REAL,
      resolution TEXT,
      candidates TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
  `);

  return db;
}

// ─── Graph read/write ────────────────────────────────────────────────────

export async function writeGraphToDb(root: string, graph: CodeGraph): Promise<void> {
  validateGraphIntegrity(graph);
  
  // Migrate from old JSON DB if exists
  const oldJsonPath = join(root, ".codegraph", "graph.json");
  if (existsSync(oldJsonPath)) {
    try { renameSync(oldJsonPath, oldJsonPath + ".migrated"); } catch {}
  }

  const db = getDb(root);
  
  const insertNode = db.prepare(`
    INSERT OR REPLACE INTO nodes (id, type, name, path, language, line, startLine, endLine, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertEdge = db.prepare(`
    INSERT OR REPLACE INTO edges (id, type, source, target, evidence, confidence, resolution, candidates)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const setMetadata = db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`);

  // Run in transaction
  const runTransaction = () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM nodes');
      db.exec('DELETE FROM edges');
      db.exec('DELETE FROM metadata');

    setMetadata.run('version', graph.version);
    setMetadata.run('generatedAt', graph.generatedAt);
    setMetadata.run('metadata', JSON.stringify(graph.metadata));

    for (const node of graph.nodes) {
      insertNode.run(
        node.id, node.type, node.name, node.path, node.language ?? null, 
        node.line ?? null, node.startLine ?? null, node.endLine ?? null, node.summary ?? null
      );
    }
    for (const edge of graph.edges) {
      insertEdge.run(
        edge.id, edge.type, edge.source, edge.target, edge.evidence ?? null, 
        edge.confidence ?? null, edge.resolution ?? null, 
        edge.candidates ? JSON.stringify(edge.candidates) : null
      );
    }
    db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  runTransaction();
  db.close();
}

export async function readGraphFromDb(root: string): Promise<CodeGraph> {
  if (!existsSync(graphDbPath(root))) {
    return {
      version: "0.1.0",
      generatedAt: new Date(0).toISOString(),
      root,
      nodes: [],
      edges: [],
      metadata: { languages: [], filesScanned: 0, ignoredPaths: [] },
    };
  }

  const db = getDb(root);
  const nodes = db.prepare('SELECT * FROM nodes').all() as any[];
  const edges = db.prepare('SELECT * FROM edges').all() as any[];
  const metadataRows = db.prepare('SELECT * FROM metadata').all() as {key: string, value: string}[];
  
  db.close();

  const metaMap = new Map(metadataRows.map(r => [r.key, r.value]));
  
  const parsedNodes: CodeGraphNode[] = nodes.map(n => ({
    id: n.id,
    type: n.type,
    name: n.name,
    path: n.path,
    language: n.language ?? undefined,
    line: n.line ?? undefined,
    startLine: n.startLine ?? undefined,
    endLine: n.endLine ?? undefined,
    summary: n.summary ?? undefined
  }));

  const parsedEdges: CodeGraphEdge[] = edges.map(e => ({
    id: e.id,
    type: e.type,
    source: e.source,
    target: e.target,
    evidence: e.evidence ?? undefined,
    confidence: e.confidence ?? undefined,
    resolution: e.resolution ?? undefined,
    candidates: e.candidates ? JSON.parse(e.candidates) : undefined
  }));

  return {
    version: (metaMap.get('version') as any) || "0.1.0",
    generatedAt: metaMap.get('generatedAt') || new Date().toISOString(),
    root,
    nodes: parsedNodes,
    edges: parsedEdges,
    metadata: metaMap.has('metadata') ? JSON.parse(metaMap.get('metadata')!) : { languages: [], filesScanned: 0, ignoredPaths: [] },
  };
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
  if (!existsSync(graphDbPath(root))) {
    // If db doesn't exist, this should be a full write anyway
    return;
  }

  const db = getDb(root);

  // Validate replacement edges against final node set
  const finalNodeIds = new Set(replacementNodes.map((node) => node.id));
  
  // To properly validate edges incrementally, we only need to make sure their source/target
  // either exists in replacementNodes OR already exists in DB.
  const checkNode = db.prepare('SELECT 1 FROM nodes WHERE id = ?');
  
  for (const edge of replacementEdges) {
    if (!finalNodeIds.has(edge.source) && !checkNode.get(edge.source)) {
      throw new Error(`Graph edge ${edge.id} references missing source ${edge.source}`);
    }
    if (!finalNodeIds.has(edge.target) && !checkNode.get(edge.target)) {
      throw new Error(`Graph edge ${edge.id} references missing target ${edge.target}`);
    }
  }

  const deleteNodesByPath = db.prepare(`DELETE FROM nodes WHERE path = ?`);
  const deleteEdgesBySource = db.prepare(`DELETE FROM edges WHERE source = ?`);
  const deleteEdgesByTarget = db.prepare(`DELETE FROM edges WHERE target = ?`);

  const insertNode = db.prepare(`
    INSERT OR REPLACE INTO nodes (id, type, name, path, language, line, startLine, endLine, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertEdge = db.prepare(`
    INSERT OR REPLACE INTO edges (id, type, source, target, evidence, confidence, resolution, candidates)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runTransaction = () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      // For each path, find nodes being deleted and delete their connected edges
    for (const path of paths) {
      const nodesToDelete = db.prepare('SELECT id FROM nodes WHERE path = ?').all(path) as {id: string}[];
      for (const row of nodesToDelete) {
        deleteEdgesBySource.run(row.id);
        deleteEdgesByTarget.run(row.id);
      }
      deleteNodesByPath.run(path);
    }

    // Insert new nodes
    for (const node of replacementNodes) {
      insertNode.run(
        node.id, node.type, node.name, node.path, node.language ?? null, 
        node.line ?? null, node.startLine ?? null, node.endLine ?? null, node.summary ?? null
      );
    }

    // Insert new edges
    for (const edge of replacementEdges) {
      insertEdge.run(
        edge.id, edge.type, edge.source, edge.target, edge.evidence ?? null, 
        edge.confidence ?? null, edge.resolution ?? null, 
        edge.candidates ? JSON.stringify(edge.candidates) : null
      );
    }

    // Update metadata counts
    const nodesCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
    const edgesCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as any).c;
    
    const existingMetaRow = db.prepare("SELECT value FROM metadata WHERE key = 'metadata'").get() as {value: string} | undefined;
    if (existingMetaRow) {
      try {
        const meta = JSON.parse(existingMetaRow.value);
        meta.nodesCount = nodesCount;
        meta.edgesCount = edgesCount;
        db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('metadata', JSON.stringify(meta));
      } catch {}
    }
    db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  runTransaction();
  db.close();
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
