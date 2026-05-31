import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DuckDBValue } from "@duckdb/node-api";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
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

/**
 * Singleton-ish wrapper: one DuckDB instance per database path.
 * DuckDB Neo API is async, so all functions are async.
 */
class GraphDatabase {
  private static instances = new Map<string, GraphDatabase>();

  static async open(root: string): Promise<GraphDatabase> {
    const dbPath = graphDbPath(root);
    const existing = GraphDatabase.instances.get(dbPath);
    if (existing) return existing;

    mkdirSync(join(root, ".codegraph"), { recursive: true });
    const gdb = new GraphDatabase(dbPath);
    await gdb.init();
    GraphDatabase.instances.set(dbPath, gdb);
    return gdb;
  }

  static close(root: string): void {
    const dbPath = graphDbPath(root);
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb && gdb.conn && gdb.instance) {
      gdb.conn.disconnectSync();
      gdb.instance.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }

  private instance: DuckDBInstance | null = null;
  private conn: DuckDBConnection | null = null;
  private readonly dbPath: string;

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async init(): Promise<void> {
    this.instance = await DuckDBInstance.create(this.dbPath, {
      threads: "2",
    });
    this.conn = await this.instance.connect();
    await ensureSchema(this.conn);
  }

  private getConn(): DuckDBConnection {
    return this.conn!;
  }

  async run(sql: string, ...params: DuckDBValue[]): Promise<void> {
    const values = params.length > 0 ? params : undefined;
    await this.getConn().run(sql, values);
  }

  async all<T>(sql: string, ...params: DuckDBValue[]): Promise<T[]> {
    const values = params.length > 0 ? params : undefined;
    const reader = await this.getConn().runAndReadAll(sql, values);
    await reader.readAll();
    return reader.getRowObjects() as T[];
  }

  async get<T>(sql: string, ...params: DuckDBValue[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  async exec(sql: string): Promise<void> {
    await this.conn!.run(sql);
  }

  async close(): Promise<void> {
    GraphDatabase.closeById(this.dbPath);
  }

  static closeById(dbPath: string): void {
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb) {
      gdb.conn?.disconnectSync();
      gdb.instance?.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }
}

// ---- Public API ----

export function graphDbPath(root: string): string {
  return join(root, ".codegraph", "graph.db");
}

export async function graphDbExists(root: string): Promise<boolean> {
  const path = graphDbPath(root);
  if (!existsSync(path)) return false;

  try {
    const db = await GraphDatabase.open(root);
    const version = (
      await db.get<MetadataRow>("SELECT key, value FROM metadata WHERE key = 'schemaVersion'")
    )?.value;
    return version === schemaVersion;
  } catch {
    return false;
  }
}

export async function readScanCache(root: string): Promise<ScanCacheData> {
  if (!existsSync(graphDbPath(root))) return { files: {} };

  const db = await GraphDatabase.open(root);
  try {
    const query = `SELECT path, hash, mtime, size, language, scannerVersion, nodes, localEdges, importMapEntries FROM scan_cache`;
    const rows = await db.all<ScanCacheRow>(query);

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
    // Keep connection alive for reuse
  }
}

export async function writeScanCache(root: string, cache: ScanCacheData): Promise<void> {
  const db = await GraphDatabase.open(root);
  try {
    await db.run("BEGIN");
    try {
      await db.run("DELETE FROM scan_cache");
      for (const [path, entry] of Object.entries(cache.files)) {
        await db.run(
          "INSERT INTO scan_cache (path, hash, mtime, size, language, scannerVersion, nodes, localEdges, importMapEntries) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
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
      await db.run("COMMIT");
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
  } finally {
    // Keep connection alive for reuse
  }
}

export async function writeGraphToDb(root: string, graph: CodeGraph): Promise<void> {
  validateGraphIntegrity(graph);
  const db = await GraphDatabase.open(root);
  try {
    await db.run("BEGIN");
    try {
      await db.run("DELETE FROM metadata");
      await db.run("DELETE FROM nodes");
      await db.run("DELETE FROM edges");

      await writeMetadataRows(db, graph);

      for (const node of graph.nodes) {
        await db.run(
          "INSERT INTO nodes (id, type, name, path, language, line, startLine, endLine, summary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
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

      for (const edge of graph.edges) {
        await db.run(
          "INSERT INTO edges (id, type, source, target, evidence, confidence, resolution, candidates) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
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
      await db.run("COMMIT");
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
  } finally {
    // Keep connection alive for reuse
  }
}

export async function replaceGraphPathsInDb(
  root: string,
  graph: CodeGraph,
  paths: string[],
  replacementNodes: CodeGraphNode[],
  replacementEdges: CodeGraphEdge[],
): Promise<void> {
  const db = await GraphDatabase.open(root);
  try {
    // Read all existing nodes from DB
    const existingRows = await db.all<NodeRow>(
      "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes",
    );
    const existingNodes = existingRows.map(nodeFromRow);

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

    await db.run("BEGIN");
    try {
      // Read current node IDs for the provided paths
      const nodeIdsToDelete: string[] = [];
      for (const path of paths) {
        const rows = await db.all<{ id: string }>("SELECT id FROM nodes WHERE path = $1", path);
        for (const row of rows) {
          nodeIdsToDelete.push(row.id);
        }
      }

      // Delete edges where source or target is one of those node IDs
      for (const nodeId of nodeIdsToDelete) {
        await db.run("DELETE FROM edges WHERE source = $1 OR target = $2", nodeId, nodeId);
      }

      // Delete nodes for those paths
      for (const path of paths) {
        await db.run("DELETE FROM nodes WHERE path = $1", path);
      }

      // Insert replacement nodes
      for (const node of replacementNodes) {
        await db.run(
          "INSERT INTO nodes (id, type, name, path, language, line, startLine, endLine, summary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
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
      for (const edge of replacementEdges) {
        await db.run(
          "INSERT OR REPLACE INTO edges (id, type, source, target, evidence, confidence, resolution, candidates) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
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
      await writeMetadataRows(db, graph);

      await db.run("COMMIT");
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
  } finally {
    // Keep connection alive for reuse
  }
}

export async function readGraphFromDb(root: string): Promise<CodeGraph> {
  const db = await GraphDatabase.open(root);
  try {
    const metadata = await readMetadata(db);
    const nodeRows = await db.all<NodeRow>(
      "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes",
    );
    const nodes = nodeRows.map(nodeFromRow);
    const edgeRows = await db.all<EdgeRow>(
      "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges",
    );
    const edges = edgeRows.map(edgeFromRow);

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
    // Keep connection alive for reuse
  }
}

export async function queryNodeById(root: string, id: string): Promise<CodeGraphNode | undefined> {
  const db = await GraphDatabase.open(root);
  try {
    const row = await db.get<NodeRow>(
      "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE id = $1",
      id,
    );
    return row ? nodeFromRow(row) : undefined;
  } finally {
    // Keep connection alive for reuse
  }
}

export async function queryNodesByName(root: string, name: string): Promise<CodeGraphNode[]> {
  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<NodeRow>(
      "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE name = $1",
      name,
    );
    return rows.map(nodeFromRow);
  } finally {
    // Keep connection alive for reuse
  }
}

export async function queryNodesByPath(root: string, path: string): Promise<CodeGraphNode[]> {
  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<NodeRow>(
      "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE path = $1",
      path,
    );
    return rows.map(nodeFromRow);
  } finally {
    // Keep connection alive for reuse
  }
}

export async function queryEdgesBySource(root: string, source: string): Promise<CodeGraphEdge[]> {
  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<EdgeRow>(
      "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges WHERE source = $1",
      source,
    );
    return rows.map(edgeFromRow);
  } finally {
    // Keep connection alive for reuse
  }
}

export async function queryEdgesByTarget(root: string, target: string): Promise<CodeGraphEdge[]> {
  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<EdgeRow>(
      "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges WHERE target = $1",
      target,
    );
    return rows.map(edgeFromRow);
  } finally {
    // Keep connection alive for reuse
  }
}

// ---- Private helpers ----

async function writeMetadataRows(db: GraphDatabase, graph: CodeGraph): Promise<void> {
  await db.run("DELETE FROM metadata");
  const pairs: [string, string][] = [
    ["schemaVersion", schemaVersion],
    ["version", graph.version],
    ["generatedAt", graph.generatedAt],
    ["root", graph.root],
    ["languages", JSON.stringify(graph.metadata.languages)],
    ["filesScanned", String(graph.metadata.filesScanned)],
    ["ignoredPaths", JSON.stringify(graph.metadata.ignoredPaths)],
    ["nodesCount", String(graph.metadata.nodesCount ?? graph.nodes.length)],
    ["edgesCount", String(graph.metadata.edgesCount ?? graph.edges.length)],
    ["nodeTypes", JSON.stringify(graph.metadata.nodeTypes ?? countNodeTypes(graph.nodes))],
    ["edgeTypes", JSON.stringify(graph.metadata.edgeTypes ?? countEdgeTypes(graph.edges))],
    ["relationshipCoverage", String(graph.metadata.relationshipCoverage ?? 0)],
    ["qualityScore", String(graph.metadata.qualityScore ?? 0)],
  ];
  for (const [key, value] of pairs) {
    await db.run("INSERT INTO metadata (key, value) VALUES ($1, $2)", key, value);
  }
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

async function readMetadata(db: GraphDatabase): Promise<Map<string, string>> {
  const rows = await db.all<MetadataRow>("SELECT key, value FROM metadata");
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
