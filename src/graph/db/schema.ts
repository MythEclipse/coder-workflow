import type { DuckDBConnection } from "@duckdb/node-api";

export const schemaVersion = "2";

export async function ensureSchema(db: DuckDBConnection): Promise<void> {
  await db.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      language TEXT,
      line INTEGER,
      startLine INTEGER,
      endLine INTEGER,
      summary TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
    CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      evidence TEXT,
      confidence REAL,
      resolution TEXT,
      candidates TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

    CREATE TABLE IF NOT EXISTS scan_cache (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      mtime DOUBLE NOT NULL,
      size DOUBLE,
      language TEXT,
      scannerVersion TEXT,
      nodes TEXT NOT NULL,
      localEdges TEXT NOT NULL,
      importMapEntries TEXT NOT NULL
    );
  `);
}
