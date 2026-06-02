export const schemaVersion = "3";

export interface SchemaExecutor {
  exec(sql: string): Promise<void>;
}

export async function ensureSchema(db: SchemaExecutor): Promise<void> {
  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await db.exec(`
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
    )
  `);

  // Create node indices
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)
  `);

  // Create edges table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      evidence TEXT,
      confidence REAL,
      resolution TEXT,
      candidates TEXT
    )
  `);

  // Create edge indices
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)
  `);

  // Create scan cache table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scan_cache (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      mtime REAL NOT NULL,
      size REAL,
      language TEXT,
      scannerVersion TEXT,
      nodes TEXT NOT NULL,
      localEdges TEXT NOT NULL,
      importMapEntries TEXT NOT NULL
    )
  `);
}
