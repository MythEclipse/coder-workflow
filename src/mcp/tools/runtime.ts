import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry { name: string; tool: McpTool }

function listFiles(dir: string, predicate: (f: string) => boolean): string[] {
  const result: string[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") result.push(...listFiles(full, predicate));
      else if (e.isFile() && predicate(full)) result.push(full);
    }
  } catch { /* skip */ }
  return result;
}

// ─── 1. Feature Flag Brain ────────────────────────────────────────────
export const featureFlagBrain: ToolEntry = {
  name: "feature-flag-brain",
  tool: {
    description: "Scans for feature flag patterns in code (process.env, feature flags, config flags)",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const files = listFiles(dir, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const flags: Array<{ name: string; locations: string[]; enabled: boolean }> = [];
      const flagMap = new Map<string, { locations: string[]; values: string[] }>();
      for (const f of files) {
        try {
          const content = readFileSync(f, "utf-8");
          const envMatches = content.matchAll(/process\.env\.(\w+_FLAG|\w+_FEATURE|\w+_ENABLED)/g);
          for (const m of envMatches) {
            if (!flagMap.has(m[1])) flagMap.set(m[1], { locations: [], values: [] });
            flagMap.get(m[1])!.locations.push(relative(root, f));
          }
          const boolMatches = content.matchAll(/(isFeatureEnabled|featureFlag|flagEnabled)\(['"](\w+)['"]\)/g);
          for (const m of boolMatches) {
            const name = m[2];
            if (!flagMap.has(name)) flagMap.set(name, { locations: [], values: [] });
            flagMap.get(name)!.locations.push(relative(root, f));
          }
        } catch { /* skip */ }
      }
      for (const [name, data] of flagMap) {
        const enabled = data.values.some((v) => v === "true" || v === "1");
        flags.push({ name, locations: [...new Set(data.locations)], enabled });
      }
      return { flags };
    },
  },
};

// ─── 2. Query Performance Whisperer ────────────────────────────────────
export const queryPerformanceWhisperer: ToolEntry = {
  name: "query-performance-whisperer",
  tool: {
    description: "Scans for ORM query patterns and reports potential N+1 risks",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const files = listFiles(dir, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const risks: Array<{ file: string; line: number; pattern: string }> = [];
      const patterns = [
        /\bfindMany\b/, /\b\.find\s*\(/, /\b\.findAll\s*\(/, /\b\.query\s*\(/,
        /\b\.create\s*\(/, /\b\.update\s*\(/, /\b\.delete\s*\(/, /\b\.aggregate\s*\(/,
        /\bprisma\.\w+\.findMany/, /\bprisma\.\w+\.findUnique/,
        /\bfor\s*(?:const|let|var)\s+\w+\s+of\s+\w+\.\w+\s*\{[^}]*\bfind/
      ];
      for (const f of files) {
        try {
          const lines = readFileSync(f, "utf-8").split("\n");
          for (let i = 0; i < lines.length; i++) {
            for (const p of patterns) {
              if (p.test(lines[i])) risks.push({ file: relative(root, f), line: i + 1, pattern: p.source.slice(0, 60) });
            }
          }
        } catch { /* skip */ }
      }
      return { risks: risks.slice(0, 50) };
    },
  },
};

// ─── 3. Chaos Predictor ───────────────────────────────────────────────
export const chaosPredictor: ToolEntry = {
  name: "chaos-predictor",
  tool: {
    description: "Finds error-prone catch blocks and unchecked promise rejections",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const files = listFiles(dir, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const riskyCatches: Array<{ file: string; line: number }> = [];
      const unhandled: Array<{ file: string; line: number }> = [];
      for (const f of files) {
        try {
          const lines = readFileSync(f, "utf-8").split("\n");
          const text = lines.join("\n");
          // Empty catch blocks
          const catchMatches = text.matchAll(/catch\s*\([^)]*\)\s*\{\s*\}/g);
          for (const m of catchMatches) {
            const lineNum = text.slice(0, m.index!).split("\n").length;
            riskyCatches.push({ file: relative(root, f), line: lineNum });
          }
          // .catch without handler
          const dotCatch = text.matchAll(/\.catch\s*\(\s*\)/g);
          for (const m of dotCatch) {
            const lineNum = text.slice(0, m.index!).split("\n").length;
            unhandled.push({ file: relative(root, f), line: lineNum });
          }
        } catch { /* skip */ }
      }
      return { riskyCatches, unhandledRejections: unhandled };
    },
  },
};

// ─── 4. Distributed Trace Narrator ─────────────────────────────────────
export const distributedTraceNarrator: ToolEntry = {
  name: "distributed-trace-narrator",
  tool: {
    description: "Reads structured log files and extracts trace/span patterns",
    inputSchema: { type: "object", properties: { logPath: { type: "string" } } },
    handler: async (args, root) => {
      const logPath = (args.logPath as string) ? resolve(root, args.logPath as string) : join(root, "logs");
      if (!existsSync(logPath)) return { traces: [], message: `Log path not found: ${logPath}` };
      const stat = statSync(logPath);
      if (stat.isFile()) {
        const content = readFileSync(logPath, "utf-8");
        const traceIds = [...new Set(content.match(/"trace_id"\s*:\s*"([^"]+)"/g) || [])];
        return { traces: traceIds.map((t) => ({ traceId: t.replace(/"trace_id"\s*:\s*"/, "").replace(/"$/, ""), spans: 1, duration: 0 })), source: logPath };
      }
      const logFiles = readdirSync(logPath).filter((f) => f.endsWith(".log") || f.endsWith(".jsonl")).slice(0, 5);
      if (logFiles.length === 0) return { traces: [], message: "No log files found" };
      return { traces: [], message: `Found ${logFiles.length} log files. Use logPath to specify one.`, files: logFiles };
    },
  },
};

// ─── 5. Schema Evolution Guardian ──────────────────────────────────────
export const schemaEvolutionGuardian: ToolEntry = {
  name: "schema-evolution-guardian",
  tool: {
    description: "Compares current Prisma schema against a snapshot",
    inputSchema: { type: "object", properties: { schemaPath: { type: "string" }, snapshotPath: { type: "string" } } },
    handler: async (args, root) => {
      const schemaPath = resolve(root, (args.schemaPath as string) || "prisma/schema.prisma");
      const snapshotPath = args.snapshotPath ? resolve(root, args.snapshotPath as string) : "";
      if (!existsSync(schemaPath)) return { changes: [], message: "Schema file not found" };
      const current = readFileSync(schemaPath, "utf-8");
      const models = [...current.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/g)].map((m) => ({
        name: m[1], fields: [...m[2].matchAll(/(\w+)\s+(\w+)/g)].map((f) => ({ name: f[1], type: f[2] })),
      }));
      if (!snapshotPath || !existsSync(snapshotPath)) return { models, changes: [], message: "No snapshot to compare against" };
      const snapshot = readFileSync(snapshotPath, "utf-8");
      const oldModels = [...snapshot.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/g)].map((m) => ({
        name: m[1], fields: [...m[2].matchAll(/(\w+)\s+(\w+)/g)].map((f) => ({ name: f[1], type: f[2] })),
      }));
      const changes: Array<{ field: string; type: string; change: string }> = [];
      for (const m of models) {
        const old = oldModels.find((o) => o.name === m.name);
        if (!old) { changes.push({ field: m.name, type: "model", change: "added" }); continue; }
        for (const f of m.fields) {
          if (!old.fields.find((of) => of.name === f.name))
            changes.push({ field: `${m.name}.${f.name}`, type: "field", change: "added" });
        }
        for (const of_ of old.fields) {
          const cur = m.fields.find((cf) => cf.name === of_.name);
          if (!cur) changes.push({ field: `${m.name}.${of_.name}`, type: "field", change: "removed" });
          else if (cur.type !== of_.type) changes.push({ field: `${m.name}.${of_.name}`, type: "field", change: `type changed: ${of_.type} → ${cur.type}` });
        }
      }
      for (const old of oldModels) {
        if (!models.find((m) => m.name === old.name))
          changes.push({ field: old.name, type: "model", change: "removed" });
      }
      return { changes };
    },
  },
};

// ─── 6. Event Storm Mapper ────────────────────────────────────────────
export const eventStormMapper: ToolEntry = {
  name: "event-storm-mapper",
  tool: {
    description: "Scans for event emitter patterns (emit, on, publish, subscribe)",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const files = listFiles(dir, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const events = new Map<string, { emitters: string[]; listeners: string[] }>();
      for (const f of files) {
        try {
          const content = readFileSync(f, "utf-8");
          const emits = content.matchAll(/\.emit\(['"]([^'"]+)['"]/g);
          for (const m of emits) {
            if (!events.has(m[1])) events.set(m[1], { emitters: [], listeners: [] });
            events.get(m[1])!.emitters.push(relative(root, f));
          }
          const listens = content.matchAll(/\.(on|subscribe)\(['"]([^'"]+)['"]/g);
          for (const m of listens) {
            if (!events.has(m[2])) events.set(m[2], { emitters: [], listeners: [] });
            events.get(m[2])!.listeners.push(relative(root, f));
          }
          const publishes = content.matchAll(/\bpublish\(['"]([^'"]+)['"]/g);
          for (const m of publishes) {
            if (!events.has(m[1])) events.set(m[1], { emitters: [], listeners: [] });
            events.get(m[1])!.emitters.push(relative(root, f));
          }
        } catch { /* skip */ }
      }
      const eventList = [...events.entries()].map(([eventName, data]) => ({
        eventName, emitters: [...new Set(data.emitters)], listeners: [...new Set(data.listeners)],
      }));
      return { events: eventList };
    },
  },
};

// ─── 7. Migration Complexity Estimator ─────────────────────────────────
export const migrationComplexityEstimator: ToolEntry = {
  name: "migration-complexity-estimator",
  tool: {
    description: "Analyzes SQL/Prisma migration files for size and complexity",
    inputSchema: { type: "object", properties: { migrationsDir: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.migrationsDir as string) || "prisma/migrations");
      if (!existsSync(dir)) {
        const altDirs = ["migrations", "db/migrations", "database/migrations"].map((d) => join(root, d)).filter(existsSync);
        if (altDirs.length === 0) return { migrations: [], message: "No migrations directory found" };
        return { migrations: [], message: `Try migrations directory: ${altDirs[0]}`, hint: altDirs[0] };
      }
      const entries = readdirSync(dir, { withFileTypes: true });
      const migrations: Array<{ file: string; size: number; statements: number; complexity: "low" | "medium" | "high" }> = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const migrationDir = join(dir, e.name);
        const sqlFiles = readdirSync(migrationDir).filter((f) => f.endsWith(".sql"));
        for (const sf of sqlFiles) {
          const fullPath = join(migrationDir, sf);
          const content = readFileSync(fullPath, "utf-8");
          const size = statSync(fullPath).size;
          const statements = (content.match(/;/g) || []).length;
          let complexity: "low" | "medium" | "high" = "low";
          if (statements > 10 || content.length > 5000) complexity = "high";
          else if (statements > 5 || content.length > 2000) complexity = "medium";
          migrations.push({ file: join(e.name, sf), size, statements, complexity });
        }
      }
      return { migrations };
    },
  },
};
