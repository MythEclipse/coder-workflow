import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";
import { ensureSchema, schemaVersion } from "./db/schema.js";

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

interface NodeRow {
  id: string;
  type: CodeGraphNode["type"];
  name: string;
  path: string;
  language: string | null;
  line: number | null;
  startLine: number | null;
  endLine: number | null;
  summary: string | null;
}

interface EdgeRow {
  id: string;
  type: CodeGraphEdge["type"];
  source: string;
  target: string;
  evidence: string | null;
  confidence: number | null;
  resolution: string | null;
  candidates: string | null;
}

interface MetadataRow {
  key: string;
  value: string;
}

interface ScanCacheRow {
  path: string;
  hash: string;
  mtime: number;
  size: number | null;
  language: string | null;
  scannerVersion: string | null;
  nodes: string;
  localEdges: string;
  importMapEntries: string;
}

export function graphDbPath(root: string): string {
  return join(root, ".codegraph", "graph.db");
}

export function graphDbExists(root: string): boolean {
  const path = graphDbPath(root);
  if (!existsSync(path)) return false;

  try {
    const db = openGraphDb(root);
    const version = readMetadata(db).get("schemaVersion");
    db.close();
    return version === schemaVersion;
  } catch {
    return false;
  }
}

export function openGraphDb(root: string): DatabaseSync {
  mkdirSync(join(root, ".codegraph"), { recursive: true });
  const db = new DatabaseSync(graphDbPath(root));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  ensureSchema(db);
  return db;
}

export function readScanCache(root: string): ScanCacheData {
  if (!existsSync(graphDbPath(root))) return { files: {} };

  const db = openGraphDb(root);
  try {
    // Check which columns exist in the scan_cache table
    const tableInfo = db.prepare("PRAGMA table_info(scan_cache)").all() as Array<{ name: string }>;
    const columnNames = new Set(tableInfo.map((col) => col.name));

    // Build SELECT query based on available columns
    const selectCols = ["path", "hash", "mtime", "nodes", "localEdges", "importMapEntries"];
    if (columnNames.has("size")) selectCols.splice(3, 0, "size");
    if (columnNames.has("language"))
      selectCols.splice(columnNames.has("size") ? 4 : 3, 0, "language");
    if (columnNames.has("scannerVersion")) selectCols.push("scannerVersion");

    const query = `SELECT ${selectCols.join(", ")} FROM scan_cache`;
    const rows = db.prepare(query).all() as unknown as ScanCacheRow[];

    const files: Record<string, ScanCacheEntry> = {};
    for (const row of rows) {
      files[row.path] = {
        hash: row.hash,
        mtime: row.mtime,
        size: row.size ?? undefined,
        language: row.language ?? undefined,
        scannerVersion: row.scannerVersion ?? "",
        nodes: JSON.parse(row.nodes) as CodeGraphNode[],
        localEdges: JSON.parse(row.localEdges) as CodeGraphEdge[],
        importMapEntries: JSON.parse(row.importMapEntries) as [string, string][],
      };
    }
    return { files };
  } finally {
    db.close();
  }
}

export function writeScanCache(root: string, cache: ScanCacheData): void {
  const db = openGraphDb(root);
  try {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM scan_cache").run();
      const insert = db.prepare(
        "INSERT INTO scan_cache (path, hash, mtime, size, language, scannerVersion, nodes, localEdges, importMapEntries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const [path, entry] of Object.entries(cache.files)) {
        insert.run(
          path,
          entry.hash,
          entry.mtime,
          entry.size ?? null,
          entry.language ?? null,
          entry.scannerVersion,
          JSON.stringify(entry.nodes),
          JSON.stringify(entry.localEdges),
          JSON.stringify(entry.importMapEntries),
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export function writeGraphToDb(root: string, graph: CodeGraph): void {
  validateGraphIntegrity(graph);
  const db = openGraphDb(root);
  try {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM metadata").run();
      db.prepare("DELETE FROM nodes").run();
      db.prepare("DELETE FROM edges").run();

      writeMetadataRows(db, graph);

      const insertNode = db.prepare(
        "INSERT INTO nodes (id, type, name, path, language, line, startLine, endLine, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const node of graph.nodes) {
        insertNode.run(
          node.id,
          node.type,
          node.name,
          node.path,
          node.language ?? null,
          node.line ?? null,
          node.startLine ?? null,
          node.endLine ?? null,
          node.summary ?? null,
        );
      }

      const insertEdge = db.prepare(
        "INSERT INTO edges (id, type, source, target, evidence, confidence, resolution, candidates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const edge of graph.edges) {
        insertEdge.run(
          edge.id,
          edge.type,
          edge.source,
          edge.target,
          edge.evidence ?? null,
          edge.confidence ?? null,
          edge.resolution ?? null,
          edge.candidates ? JSON.stringify(edge.candidates) : null,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export function replaceGraphPathsInDb(
  root: string,
  graph: CodeGraph,
  paths: string[],
  replacementNodes: CodeGraphNode[],
  replacementEdges: CodeGraphEdge[],
): void {
  const db = openGraphDb(root);
  try {
    // Read all existing nodes from DB
    const existingNodes = (
      db
        .prepare(
          "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes",
        )
        .all() as unknown as NodeRow[]
    ).map(nodeFromRow);

    // Build the final node set: existing nodes (excluding replaced paths) + replacement nodes
    const pathSet = new Set(paths);
    const preservedNodes = existingNodes.filter((node) => !pathSet.has(node.path));
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

    db.exec("BEGIN");
    try {
      // Read current node IDs for the provided paths
      const nodeIdsToDelete: string[] = [];
      const selectNodes = db.prepare("SELECT id FROM nodes WHERE path = ?");
      for (const path of paths) {
        const rows = selectNodes.all(path) as Array<{ id: string }>;
        for (const row of rows) {
          nodeIdsToDelete.push(row.id);
        }
      }

      // Delete edges where source or target is one of those node IDs
      const deleteEdges = db.prepare("DELETE FROM edges WHERE source = ? OR target = ?");
      for (const nodeId of nodeIdsToDelete) {
        deleteEdges.run(nodeId, nodeId);
      }

      // Delete nodes for those paths
      const deleteNodes = db.prepare("DELETE FROM nodes WHERE path = ?");
      for (const path of paths) {
        deleteNodes.run(path);
      }

      // Insert replacement nodes
      const insertNode = db.prepare(
        "INSERT INTO nodes (id, type, name, path, language, line, startLine, endLine, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const node of replacementNodes) {
        insertNode.run(
          node.id,
          node.type,
          node.name,
          node.path,
          node.language ?? null,
          node.line ?? null,
          node.startLine ?? null,
          node.endLine ?? null,
          node.summary ?? null,
        );
      }

      // Insert or replace replacement edges
      const insertEdge = db.prepare(
        "INSERT OR REPLACE INTO edges (id, type, source, target, evidence, confidence, resolution, candidates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const edge of replacementEdges) {
        insertEdge.run(
          edge.id,
          edge.type,
          edge.source,
          edge.target,
          edge.evidence ?? null,
          edge.confidence ?? null,
          edge.resolution ?? null,
          edge.candidates ? JSON.stringify(edge.candidates) : null,
        );
      }

      // Rewrite metadata from graph.metadata
      writeMetadataRows(db, graph);

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export function readGraphFromDb(root: string): CodeGraph {
  const db = openGraphDb(root);
  try {
    const metadata = readMetadata(db);
    const nodes = (
      db
        .prepare(
          "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes",
        )
        .all() as unknown as NodeRow[]
    ).map(nodeFromRow);
    const edges = (
      db
        .prepare(
          "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges",
        )
        .all() as unknown as EdgeRow[]
    ).map(edgeFromRow);

    return {
      version: "0.1.0",
      generatedAt: metadata.get("generatedAt") ?? new Date(0).toISOString(),
      root: metadata.get("root") ?? root,
      nodes,
      edges,
      metadata: {
        languages: JSON.parse(metadata.get("languages") ?? "[]") as string[],
        filesScanned: Number(metadata.get("filesScanned") ?? 0),
        ignoredPaths: JSON.parse(metadata.get("ignoredPaths") ?? "[]") as string[],
        nodesCount: Number(metadata.get("nodesCount") ?? nodes.length),
        edgesCount: Number(metadata.get("edgesCount") ?? edges.length),
        nodeTypes: JSON.parse(
          metadata.get("nodeTypes") ?? JSON.stringify(countNodeTypes(nodes)),
        ) as CodeGraph["metadata"]["nodeTypes"],
        edgeTypes: JSON.parse(
          metadata.get("edgeTypes") ?? JSON.stringify(countEdgeTypes(edges)),
        ) as CodeGraph["metadata"]["edgeTypes"],
        relationshipCoverage: Number(metadata.get("relationshipCoverage") ?? 0),
        qualityScore: Number(metadata.get("qualityScore") ?? 0),
      },
    };
  } finally {
    db.close();
  }
}

export function queryNodeById(root: string, id: string): CodeGraphNode | undefined {
  const db = openGraphDb(root);
  try {
    const row = db
      .prepare(
        "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE id = ?",
      )
      .get(id) as NodeRow | undefined;
    return row ? nodeFromRow(row) : undefined;
  } finally {
    db.close();
  }
}

export function queryNodesByName(root: string, name: string): CodeGraphNode[] {
  const db = openGraphDb(root);
  try {
    return (
      db
        .prepare(
          "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE name = ?",
        )
        .all(name) as unknown as NodeRow[]
    ).map(nodeFromRow);
  } finally {
    db.close();
  }
}

export function queryNodesByPath(root: string, path: string): CodeGraphNode[] {
  const db = openGraphDb(root);
  try {
    return (
      db
        .prepare(
          "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE path = ?",
        )
        .all(path) as unknown as NodeRow[]
    ).map(nodeFromRow);
  } finally {
    db.close();
  }
}

export function queryEdgesBySource(root: string, source: string): CodeGraphEdge[] {
  const db = openGraphDb(root);
  try {
    return (
      db
        .prepare(
          "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges WHERE source = ?",
        )
        .all(source) as unknown as EdgeRow[]
    ).map(edgeFromRow);
  } finally {
    db.close();
  }
}

export function queryEdgesByTarget(root: string, target: string): CodeGraphEdge[] {
  const db = openGraphDb(root);
  try {
    return (
      db
        .prepare(
          "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges WHERE target = ?",
        )
        .all(target) as unknown as EdgeRow[]
    ).map(edgeFromRow);
  } finally {
    db.close();
  }
}

function writeMetadataRows(db: DatabaseSync, graph: CodeGraph): void {
  db.prepare("DELETE FROM metadata").run();
  const insertMetadata = db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
  insertMetadata.run("schemaVersion", schemaVersion);
  insertMetadata.run("version", graph.version);
  insertMetadata.run("generatedAt", graph.generatedAt);
  insertMetadata.run("root", graph.root);
  insertMetadata.run("languages", JSON.stringify(graph.metadata.languages));
  insertMetadata.run("filesScanned", String(graph.metadata.filesScanned));
  insertMetadata.run("ignoredPaths", JSON.stringify(graph.metadata.ignoredPaths));
  insertMetadata.run("nodesCount", String(graph.metadata.nodesCount ?? graph.nodes.length));
  insertMetadata.run("edgesCount", String(graph.metadata.edgesCount ?? graph.edges.length));
  insertMetadata.run(
    "nodeTypes",
    JSON.stringify(graph.metadata.nodeTypes ?? countNodeTypes(graph.nodes)),
  );
  insertMetadata.run(
    "edgeTypes",
    JSON.stringify(graph.metadata.edgeTypes ?? countEdgeTypes(graph.edges)),
  );
  insertMetadata.run("relationshipCoverage", String(graph.metadata.relationshipCoverage ?? 0));
  insertMetadata.run("qualityScore", String(graph.metadata.qualityScore ?? 0));
}

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

function countNodeTypes(nodes: CodeGraphNode[]): CodeGraph["metadata"]["nodeTypes"] {
  const counts: NonNullable<CodeGraph["metadata"]["nodeTypes"]> = {};
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
  return counts;
}

function countEdgeTypes(edges: CodeGraphEdge[]): CodeGraph["metadata"]["edgeTypes"] {
  const counts: NonNullable<CodeGraph["metadata"]["edgeTypes"]> = {};
  for (const edge of edges) counts[edge.type] = (counts[edge.type] ?? 0) + 1;
  return counts;
}

function readMetadata(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare("SELECT key, value FROM metadata").all() as unknown as MetadataRow[];
  return new Map(rows.map((row) => [row.key, row.value]));
}

function nodeFromRow(row: NodeRow): CodeGraphNode {
  return withoutUndefined({
    id: row.id,
    type: row.type,
    name: row.name,
    path: row.path,
    language: row.language ?? undefined,
    line: row.line ?? undefined,
    startLine: row.startLine ?? undefined,
    endLine: row.endLine ?? undefined,
    summary: row.summary ?? undefined,
  });
}

function edgeFromRow(row: EdgeRow): CodeGraphEdge {
  return withoutUndefined({
    id: row.id,
    type: row.type,
    source: row.source,
    target: row.target,
    evidence: row.evidence ?? undefined,
    confidence: row.confidence ?? undefined,
    resolution: row.resolution ?? undefined,
    candidates: row.candidates ? (JSON.parse(row.candidates) as string[]) : undefined,
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}
