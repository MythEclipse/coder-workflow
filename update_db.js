const fs = require('fs');

let content = fs.readFileSync('src/graph/db.ts', 'utf8');

// 1. Update GraphDatabase.close
content = content.replace(
`  static close(root: string): void {
    const dbPath = graphDbPath(root);
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb && gdb.conn && gdb.instance) {
      gdb.conn.disconnectSync();
      gdb.instance.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }`,
`  static close(root: string): void {
    const dbPath = graphDbPath(root);
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb && gdb.conn && gdb.instance) {
      if (gdb.idleTimer) clearTimeout(gdb.idleTimer);
      gdb.conn.disconnectSync();
      gdb.instance.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }`);

// 2. Add idleTimer and refreshIdleTimer, and change init
content = content.replace(
`  private instance: DuckDBInstance | null = null;
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
  }`,
`  private instance: DuckDBInstance | null = null;
  private conn: DuckDBConnection | null = null;
  private readonly dbPath: string;
  private idleTimer: NodeJS.Timeout | null = null;

  private refreshIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.close().catch(console.error);
    }, 3000);
  }

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async init(): Promise<void> {
    let retries = 0;
    const maxRetries = 20;
    while (true) {
      try {
        this.instance = await DuckDBInstance.create(this.dbPath, {
          threads: "2",
        });
        break;
      } catch (error: any) {
        if (error?.message?.includes('IO Error') && error?.message?.includes('lock') && retries < maxRetries) {
          retries++;
          await new Promise((resolve) => setTimeout(resolve, 250));
        } else {
          throw error;
        }
      }
    }
    this.conn = await this.instance.connect();
    await ensureSchema(this.conn);
  }`);

// 3. Update public methods to call this.refreshIdleTimer()
content = content.replace(
`  async run(sql: string, ...params: DuckDBValue[]): Promise<void> {
    const values = params.length > 0 ? params : undefined;
    await this.getConn().run(sql, values);
  }`,
`  async run(sql: string, ...params: DuckDBValue[]): Promise<void> {
    const values = params.length > 0 ? params : undefined;
    await this.getConn().run(sql, values);
    this.refreshIdleTimer();
  }`);

content = content.replace(
`  async all<T>(sql: string, ...params: DuckDBValue[]): Promise<T[]> {
    const values = params.length > 0 ? params : undefined;
    const reader = await this.getConn().runAndReadAll(sql, values);
    await reader.readAll();
    return reader.getRowObjects() as T[];
  }`,
`  async all<T>(sql: string, ...params: DuckDBValue[]): Promise<T[]> {
    const values = params.length > 0 ? params : undefined;
    const reader = await this.getConn().runAndReadAll(sql, values);
    await reader.readAll();
    this.refreshIdleTimer();
    return reader.getRowObjects() as T[];
  }`);

content = content.replace(
`  async get<T>(sql: string, ...params: DuckDBValue[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    return rows.length > 0 ? rows[0] : undefined;
  }`,
`  async get<T>(sql: string, ...params: DuckDBValue[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    this.refreshIdleTimer();
    return rows.length > 0 ? rows[0] : undefined;
  }`);

content = content.replace(
`  async exec(sql: string): Promise<void> {
    await this.conn!.run(sql);
  }`,
`  async exec(sql: string): Promise<void> {
    await this.conn!.run(sql);
    this.refreshIdleTimer();
  }`);

content = content.replace(
`  static closeById(dbPath: string): void {
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb) {
      gdb.conn?.disconnectSync();
      gdb.instance?.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }`,
`  static closeById(dbPath: string): void {
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb) {
      if (gdb.idleTimer) clearTimeout(gdb.idleTimer);
      gdb.conn?.disconnectSync();
      gdb.instance?.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }`);

// 4. Remove `try { ... } finally { await db.close(); }` in exported functions
function removeTryFinally(str, fnName) {
  // We'll just regex this. The pattern is:
  // try {
  //   ...
  // } finally {
  //   await db.close();
  // }
  // We want to remove the 'try {' and '} finally { await db.close(); }'
  // But wait, if there's a catch block, it's `try { ... } catch (...) { ... } finally { await db.close(); }`.
  // Wait, none of the exported functions EXCEPT writeScanCache, writeGraphToDb, and replaceGraphPathsInDb have an inner try-catch?
  // Let's just find `try {\n` and `} finally {\n    await db.close();\n  }` and remove them.
  // We have to be careful not to remove the wrong ones.

  // Let's just use manual string replacements for the specific functions.
  return str;
}

// manual unwrap of try..finally blocks
const replacements = [
  // readScanCache
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    const query = \\\`SELECT path, hash, mtime, size, language, scannerVersion, nodes, localEdges, importMapEntries FROM scan_cache\\\`;\`,
    to:
\`  const db = await GraphDatabase.open(root);
  const query = \\\`SELECT path, hash, mtime, size, language, scannerVersion, nodes, localEdges, importMapEntries FROM scan_cache\\\`;\`
  },
  {
    from:
\`    return { files };
  } finally {
    await db.close();
  }\`,
    to:
\`    return { files };\`
  },
  // writeScanCache
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    await db.run("BEGIN");\`,
    to:
\`  const db = await GraphDatabase.open(root);
  await db.run("BEGIN");\`
  },
  {
    from:
\`      throw error;
    }
  } finally {
    await db.close();
  }\`,
    to:
\`      throw error;
    }\`
  },
  // writeGraphToDb
  {
    from:
\`  validateGraphIntegrity(graph);
  const db = await GraphDatabase.open(root);
  try {
    await db.run("BEGIN");\`,
    to:
\`  validateGraphIntegrity(graph);
  const db = await GraphDatabase.open(root);
  await db.run("BEGIN");\`
  },
  // replaceGraphPathsInDb
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    // Read all existing nodes from DB\`,
    to:
\`  const db = await GraphDatabase.open(root);
  // Read all existing nodes from DB\`
  },
  // readGraphFromDb
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    const metadata = await readMetadata(db);\`,
    to:
\`  const db = await GraphDatabase.open(root);
  const metadata = await readMetadata(db);\`
  },
  {
    from:
\`        qualityScore: Number(metadata.get("qualityScore") ?? 0),
      },
    };
  } finally {
    await db.close();
  }\`,
    to:
\`        qualityScore: Number(metadata.get("qualityScore") ?? 0),
      },
    };\`
  },
  // queryNodeById
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    const row = await db.get<NodeRow>(\`,
    to:
\`  const db = await GraphDatabase.open(root);
  const row = await db.get<NodeRow>(\`
  },
  {
    from:
\`      id,
    );
    return row ? nodeFromRow(row) : undefined;
  } finally {
    await db.close();
  }\`,
    to:
\`      id,
    );
    return row ? nodeFromRow(row) : undefined;\`
  },
  // queryNodesByName
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<NodeRow>(\`,
    to:
\`  const db = await GraphDatabase.open(root);
  const rows = await db.all<NodeRow>(\`
  },
  {
    from:
\`      name,
    );
    return rows.map(nodeFromRow);
  } finally {
    await db.close();
  }\`,
    to:
\`      name,
    );
    return rows.map(nodeFromRow);\`
  },
  // queryNodesByPath
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<NodeRow>(\`,
    to:
\`  const db = await GraphDatabase.open(root);
  const rows = await db.all<NodeRow>(\`
  },
  {
    from:
\`      path,
    );
    return rows.map(nodeFromRow);
  } finally {
    await db.close();
  }\`,
    to:
\`      path,
    );
    return rows.map(nodeFromRow);\`
  },
  // queryEdgesBySource
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<EdgeRow>(\`,
    to:
\`  const db = await GraphDatabase.open(root);
  const rows = await db.all<EdgeRow>(\`
  },
  {
    from:
\`      source,
    );
    return rows.map(edgeFromRow);
  } finally {
    await db.close();
  }\`,
    to:
\`      source,
    );
    return rows.map(edgeFromRow);\`
  },
  // queryEdgesByTarget
  {
    from:
\`  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<EdgeRow>(\`,
    to:
\`  const db = await GraphDatabase.open(root);
  const rows = await db.all<EdgeRow>(\`
  },
  {
    from:
\`      target,
    );
    return rows.map(edgeFromRow);
  } finally {
    await db.close();
  }\`,
    to:
\`      target,
    );
    return rows.map(edgeFromRow);\`
  },
];

for (const r of replacements) {
  content = content.replace(r.from, r.to);
}

fs.writeFileSync('src/graph/db.ts', content);
