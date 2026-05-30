import type { DatabaseSync } from "node:sqlite";

export const schemaVersion = "1";

export function ensureSchema(db: DatabaseSync): void {
  db.exec(`
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
      mtime REAL NOT NULL,
      nodes TEXT NOT NULL,
      localEdges TEXT NOT NULL,
      importMapEntries TEXT NOT NULL
    );
  `);
  ensureColumn(db, "scan_cache", "size", "REAL");
  ensureColumn(db, "scan_cache", "language", "TEXT");
  ensureColumn(db, "scan_cache", "scannerVersion", "TEXT");
  ensureColumn(db, "edges", "confidence", "REAL");
  ensureColumn(db, "edges", "resolution", "TEXT");
  ensureColumn(db, "edges", "candidates", "TEXT");
}

function ensureColumn(db: DatabaseSync, table: string, name: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
