import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Client, createClient, type InValue } from "@libsql/client";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";
import { ensureSchema, schemaVersion } from "./db/schema.js";

/**
 * Normalize parameter placeholders to SQLite-style `?`.
 * libSQL does not support `$N` (PostgreSQL-style); this helper converts:
 *   "$1  $2  $3" → "?  ?  ?"
 * so that callers can write dialect-agnostic parameterized queries.
 *
 * Edge cases handled:
 *   - `$` inside string literals: skipped (delimited by single quotes)
 *   - `$$` (PostgreSQL dollar-quoting): treated as literal, not parameter
 *   - Out-of-sequence `$3` before `$1`: auto-ordered to `?  ?  ?`
 *   - Max parameter index: validated ≤ 100 (defensive limit)
 *
 * Returns the normalized SQL string and the reordered parameter count.
 */
export function normalizePlaceholders(
  sql: string,
  paramCount: number,
): { sql: string; count: number } {
  // Fast path: already uses `?` placeholders
  if (!/\$\d+/.test(sql)) return { sql, count: paramCount };

  let result = "";
  let inString = false;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];

    // Track single-quoted strings (skip content inside them)
    if (char === "'" && (i === 0 || sql[i - 1] !== "\\")) {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    // Check for $N placeholder
    if (!inString && char === "$") {
      // $$ dollar-quoting — treat as literal
      if (i + 1 < sql.length && sql[i + 1] === "$") {
        result += "$$";
        i += 2;
        continue;
      }

      const match = sql.slice(i).match(/^\$(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num < 1 || num > 100) {
          throw new Error(
            `Invalid placeholder index $${num} in SQL — must be 1-100. ` +
              `SQL fragment: "${sql.slice(Math.max(0, i - 20), i + 30)}"`,
          );
        }
        if (num > paramCount) {
          throw new Error(
            `Placeholder $${num} exceeds declared param count ${paramCount}. ` +
              `SQL fragment: "${sql.slice(Math.max(0, i - 20), i + 30)}"`,
          );
        }
        result += "?";
        i += match[0].length;
        continue;
      }
    }

    result += char;
    i++;
  }

  return { sql: result, count: paramCount };
}

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
 * Singleton-ish wrapper: one libSQL client per database path.
 * libSQL client uses SQLite-style `?` positional placeholders.
 * `normalizePlaceholders()` auto-converts `$N` (PostgreSQL-style) to `?`
 * so that callers can use dialect-agnostic parameter references.
 */
class GraphDatabase {
  private static instances = new Map<string, GraphDatabase>();

  static async open(root: string): Promise<GraphDatabase> {
    const dbPath = graphDbPath(root);
    const existing = GraphDatabase.instances.get(dbPath);
    if (existing) return existing;

    mkdirSync(join(root, ".codegraph"), { recursive: true });
    await prepareDatabaseFile(root);
    const gdb = new GraphDatabase(dbPath);
    await gdb.init();
    GraphDatabase.instances.set(dbPath, gdb);
    return gdb;
  }

  static close(root: string): void {
    const dbPath = graphDbPath(root);
    GraphDatabase.closeById(dbPath);
  }

  private client: Client | null = null;
  private readonly dbPath: string;
  private idleTimer: NodeJS.Timeout | null = null;

  private refreshIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout((): void => {
      Promise.resolve(this.close()).catch((err) => console.error("[db] error:", err));
    }, 3000);
  }

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async init(): Promise<void> {
    this.client = createClient({
      url: `file:${this.dbPath}`,
    });

    await this.exec("PRAGMA journal_mode=WAL");
    await this.exec("PRAGMA synchronous=NORMAL");
    await this.exec("PRAGMA busy_timeout=5000");
    await ensureSchema(this);
  }

  async run(sql: string, ...params: (string | number | null | undefined)[]): Promise<void> {
    const normalized = normalizePlaceholders(sql, params.length);
    const args = params.map((p) => p ?? null) as InValue[];
    await this.client!.execute({
      sql: normalized.sql,
      args,
    });
    this.refreshIdleTimer();
  }

  async all<T>(sql: string, ...params: (string | number | null | undefined)[]): Promise<T[]> {
    const normalized = normalizePlaceholders(sql, params.length);
    const args = params.map((p) => p ?? null) as InValue[];
    const result = await this.client!.execute({
      sql: normalized.sql,
      args,
    });
    this.refreshIdleTimer();
    return (result.rows ?? []) as T[];
  }

  async get<T>(
    sql: string,
    ...params: (string | number | null | undefined)[]
  ): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    this.refreshIdleTimer();
    return rows.length > 0 ? rows[0] : undefined;
  }

  async exec(sql: string): Promise<void> {
    await this.client!.execute(sql);
    this.refreshIdleTimer();
  }

  async close(): Promise<void> {
    GraphDatabase.closeById(this.dbPath);
  }

  static closeById(dbPath: string): void {
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb) {
      if (gdb.idleTimer) clearTimeout(gdb.idleTimer);
      if (gdb.client) {
        Promise.resolve(gdb.client.close()).catch((err) => console.error("[db] error:", err));
      }
      GraphDatabase.instances.delete(dbPath);
    }
  }
}

/**
 * Handle migration from old DuckDB files to libSQL.
 * If an incompatible DB file exists, back it up and allow fresh creation.
 */
async function prepareDatabaseFile(root: string): Promise<void> {
  const dbPath = graphDbPath(root);

  // If no file exists, we're good
  if (!existsSync(dbPath)) {
    return;
  }

  // Try to open with libSQL and check schema version
  try {
    const testClient = createClient({
      url: `file:${dbPath}`,
    });
    const result = await testClient.execute(
      "SELECT value FROM metadata WHERE key = 'schemaVersion'",
    );
    testClient.close();

    if (result.rows && result.rows.length > 0) {
      const row = result.rows[0];
      const version =
        typeof row === "object" && row !== null ? (row as Record<string, unknown>).value : null;
      if (version === schemaVersion) {
        // Compatible database, use as-is
        return;
      }
    }
  } catch {
    // Database is incompatible (likely old DuckDB format)
  }

  // Backup existing incompatible database
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(root, ".codegraph", `graph.duckdb.backup.${timestamp}.db`);

  try {
    const fs = await import("node:fs/promises");
    await fs.rename(dbPath, backupPath);

    // Also try to move sidecar files
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (existsSync(walPath)) {
      await fs.rename(walPath, `${backupPath}-wal`).catch(() => {
        /* ignore */
      });
    }
    if (existsSync(shmPath)) {
      await fs.rename(shmPath, `${backupPath}-shm`).catch(() => {
        /* ignore */
      });
    }
  } catch (error) {
    console.warn(
      `Failed to backup old database at ${dbPath}. You may need to manually remove it before rescanning.`,
      error,
    );
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
  const query = `SELECT path, hash, mtime, size, language, scannerVersion, nodes, localEdges, importMapEntries FROM scan_cache`;
  const rows = await db.all<ScanCacheRow>(query);

  const files: Record<string, ScanCacheEntry> = {};
  for (const row of rows) {
    files[row.path] = {
      hash: row.hash,
      mtime: Number(row.mtime),
      size: row.size == null ? undefined : Number(row.size),
      language: row.language ?? undefined,
      scannerVersion: row.scannerVersion ?? "",
      nodes: JSON.parse(row.nodes) as CodeGraphNode[],
      localEdges: JSON.parse(row.localEdges) as CodeGraphEdge[],
      importMapEntries: JSON.parse(row.importMapEntries) as [string, string][],
    };
  }
  return { files };
}

export async function writeScanCache(root: string, cache: ScanCacheData): Promise<void> {
  const db = await GraphDatabase.open(root);
  await db.run("BEGIN");
  try {
    await db.run("DELETE FROM scan_cache");
    for (const [path, entry] of Object.entries(cache.files)) {
      await db.run(
        "INSERT INTO scan_cache (path, hash, mtime, size, language, scannerVersion, nodes, localEdges, importMapEntries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
}

export async function writeGraphToDb(root: string, graph: CodeGraph): Promise<void> {
  validateGraphIntegrity(graph);
  const db = await GraphDatabase.open(root);
  await db.run("BEGIN");
  try {
    await db.run("DELETE FROM metadata");
    await db.run("DELETE FROM nodes");
    await db.run("DELETE FROM edges");

    await writeMetadataRows(db, graph);

    for (const node of graph.nodes) {
      await db.run(
        "INSERT INTO nodes (id, type, name, path, language, line, startLine, endLine, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        "INSERT INTO edges (id, type, source, target, evidence, confidence, resolution, candidates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
}

export async function replaceGraphPathsInDb(
  root: string,
  graph: CodeGraph,
  paths: string[],
  replacementNodes: CodeGraphNode[],
  replacementEdges: CodeGraphEdge[],
): Promise<void> {
  const db = await GraphDatabase.open(root);
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
      const rows = await db.all<{ id: string }>("SELECT id FROM nodes WHERE path = ?", path);
      for (const row of rows) {
        nodeIdsToDelete.push(row.id);
      }
    }

    // Delete edges where source or target is one of those node IDs
    for (const nodeId of nodeIdsToDelete) {
      await db.run("DELETE FROM edges WHERE source = ? OR target = ?", nodeId, nodeId);
    }

    // Delete nodes for those paths
    for (const path of paths) {
      await db.run("DELETE FROM nodes WHERE path = ?", path);
    }

    // Insert replacement nodes
    for (const node of replacementNodes) {
      await db.run(
        "INSERT INTO nodes (id, type, name, path, language, line, startLine, endLine, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        "INSERT OR REPLACE INTO edges (id, type, source, target, evidence, confidence, resolution, candidates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
}

export async function readGraphFromDb(root: string): Promise<CodeGraph> {
  const db = await GraphDatabase.open(root);
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
}

export async function queryNodeById(root: string, id: string): Promise<CodeGraphNode | undefined> {
  const db = await GraphDatabase.open(root);
  const row = await db.get<NodeRow>(
    "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE id = ?",
    id,
  );
  return row ? nodeFromRow(row) : undefined;
}

export async function queryNodesByName(root: string, name: string): Promise<CodeGraphNode[]> {
  const db = await GraphDatabase.open(root);
  const rows = await db.all<NodeRow>(
    "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE name = ?",
    name,
  );
  return rows.map(nodeFromRow);
}

export async function queryNodesByPath(root: string, path: string): Promise<CodeGraphNode[]> {
  const db = await GraphDatabase.open(root);
  const rows = await db.all<NodeRow>(
    "SELECT id, type, name, path, language, line, startLine, endLine, summary FROM nodes WHERE path = ?",
    path,
  );
  return rows.map(nodeFromRow);
}

export async function queryEdgesBySource(root: string, source: string): Promise<CodeGraphEdge[]> {
  const db = await GraphDatabase.open(root);
  const rows = await db.all<EdgeRow>(
    "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges WHERE source = ?",
    source,
  );
  return rows.map(edgeFromRow);
}

export async function queryEdgesByTarget(root: string, target: string): Promise<CodeGraphEdge[]> {
  const db = await GraphDatabase.open(root);
  const rows = await db.all<EdgeRow>(
    "SELECT id, type, source, target, evidence, confidence, resolution, candidates FROM edges WHERE target = ?",
    target,
  );
  return rows.map(edgeFromRow);
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
    await db.run("INSERT INTO metadata (key, value) VALUES (?, ?)", key, value);
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
    line: row.line == null ? undefined : Number(row.line),
    startLine: row.startLine == null ? undefined : Number(row.startLine),
    endLine: row.endLine == null ? undefined : Number(row.endLine),
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
    confidence: row.confidence == null ? undefined : Number(row.confidence),
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
