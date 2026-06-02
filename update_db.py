import re

with open('src/graph/db.ts', 'r') as f:
    content = f.read()

# 1. Update GraphDatabase.close
target = """  static close(root: string): void {
    const dbPath = graphDbPath(root);
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb && gdb.conn && gdb.instance) {
      gdb.conn.disconnectSync();
      gdb.instance.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }"""
repl = """  static close(root: string): void {
    const dbPath = graphDbPath(root);
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb && gdb.conn && gdb.instance) {
      if (gdb.idleTimer) clearTimeout(gdb.idleTimer);
      gdb.conn.disconnectSync();
      gdb.instance.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }"""
content = content.replace(target, repl)

# 2. Add idleTimer and refreshIdleTimer, and change init
target = """  private instance: DuckDBInstance | null = null;
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
  }"""
repl = """  private instance: DuckDBInstance | null = null;
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
  }"""
content = content.replace(target, repl)

# 3. Update public methods to call this.refreshIdleTimer()
target = """  async run(sql: string, ...params: DuckDBValue[]): Promise<void> {
    const values = params.length > 0 ? params : undefined;
    await this.getConn().run(sql, values);
  }"""
repl = """  async run(sql: string, ...params: DuckDBValue[]): Promise<void> {
    const values = params.length > 0 ? params : undefined;
    await this.getConn().run(sql, values);
    this.refreshIdleTimer();
  }"""
content = content.replace(target, repl)

target = """  async all<T>(sql: string, ...params: DuckDBValue[]): Promise<T[]> {
    const values = params.length > 0 ? params : undefined;
    const reader = await this.getConn().runAndReadAll(sql, values);
    await reader.readAll();
    return reader.getRowObjects() as T[];
  }"""
repl = """  async all<T>(sql: string, ...params: DuckDBValue[]): Promise<T[]> {
    const values = params.length > 0 ? params : undefined;
    const reader = await this.getConn().runAndReadAll(sql, values);
    await reader.readAll();
    this.refreshIdleTimer();
    return reader.getRowObjects() as T[];
  }"""
content = content.replace(target, repl)

target = """  async get<T>(sql: string, ...params: DuckDBValue[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    return rows.length > 0 ? rows[0] : undefined;
  }"""
repl = """  async get<T>(sql: string, ...params: DuckDBValue[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    this.refreshIdleTimer();
    return rows.length > 0 ? rows[0] : undefined;
  }"""
content = content.replace(target, repl)

target = """  async exec(sql: string): Promise<void> {
    await this.conn!.run(sql);
  }"""
repl = """  async exec(sql: string): Promise<void> {
    await this.conn!.run(sql);
    this.refreshIdleTimer();
  }"""
content = content.replace(target, repl)

target = """  static closeById(dbPath: string): void {
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb) {
      gdb.conn?.disconnectSync();
      gdb.instance?.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }"""
repl = """  static closeById(dbPath: string): void {
    const gdb = GraphDatabase.instances.get(dbPath);
    if (gdb) {
      if (gdb.idleTimer) clearTimeout(gdb.idleTimer);
      gdb.conn?.disconnectSync();
      gdb.instance?.closeSync();
      GraphDatabase.instances.delete(dbPath);
    }
  }"""
content = content.replace(target, repl)

# 4. Remove `try { ... } finally { await db.close(); }` in exported functions
# Instead of regex, let's just do exact string replacements for the try and finally blocks to be safe.

# readScanCache
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    const query""", """  const db = await GraphDatabase.open(root);
  const query""")

content = content.replace("""    return { files };
  } finally {
    await db.close();
  }""", """    return { files };""")

# writeScanCache
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    await db.run("BEGIN");""", """  const db = await GraphDatabase.open(root);
  await db.run("BEGIN");""")

content = content.replace("""      throw error;
    }
  } finally {
    await db.close();
  }""", """      throw error;
    }""")

# writeGraphToDb
content = content.replace("""  validateGraphIntegrity(graph);
  const db = await GraphDatabase.open(root);
  try {
    await db.run("BEGIN");""", """  validateGraphIntegrity(graph);
  const db = await GraphDatabase.open(root);
  await db.run("BEGIN");""")

# replaceGraphPathsInDb
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    // Read all existing nodes from DB""", """  const db = await GraphDatabase.open(root);
  // Read all existing nodes from DB""")

# readGraphFromDb
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    const metadata = await readMetadata(db);""", """  const db = await GraphDatabase.open(root);
  const metadata = await readMetadata(db);""")

content = content.replace("""        qualityScore: Number(metadata.get("qualityScore") ?? 0),
      },
    };
  } finally {
    await db.close();
  }""", """        qualityScore: Number(metadata.get("qualityScore") ?? 0),
      },
    };""")


# queryNodeById
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    const row = await db.get<NodeRow>(""", """  const db = await GraphDatabase.open(root);
  const row = await db.get<NodeRow>(""")

content = content.replace("""      id,
    );
    return row ? nodeFromRow(row) : undefined;
  } finally {
    await db.close();
  }""", """      id,
    );
    return row ? nodeFromRow(row) : undefined;""")


# queryNodesByName
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<NodeRow>(""", """  const db = await GraphDatabase.open(root);
  const rows = await db.all<NodeRow>(""")

content = content.replace("""      name,
    );
    return rows.map(nodeFromRow);
  } finally {
    await db.close();
  }""", """      name,
    );
    return rows.map(nodeFromRow);""")


# queryNodesByPath
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<NodeRow>(""", """  const db = await GraphDatabase.open(root);
  const rows = await db.all<NodeRow>(""")

content = content.replace("""      path,
    );
    return rows.map(nodeFromRow);
  } finally {
    await db.close();
  }""", """      path,
    );
    return rows.map(nodeFromRow);""")


# queryEdgesBySource
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<EdgeRow>(""", """  const db = await GraphDatabase.open(root);
  const rows = await db.all<EdgeRow>(""")

content = content.replace("""      source,
    );
    return rows.map(edgeFromRow);
  } finally {
    await db.close();
  }""", """      source,
    );
    return rows.map(edgeFromRow);""")


# queryEdgesByTarget
content = content.replace("""  const db = await GraphDatabase.open(root);
  try {
    const rows = await db.all<EdgeRow>(""", """  const db = await GraphDatabase.open(root);
  const rows = await db.all<EdgeRow>(""")

content = content.replace("""      target,
    );
    return rows.map(edgeFromRow);
  } finally {
    await db.close();
  }""", """      target,
    );
    return rows.map(edgeFromRow);""")


with open('src/graph/db.ts', 'w') as f:
    f.write(content)
