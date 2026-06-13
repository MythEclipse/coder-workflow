import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry {
  name: string;
  tool: McpTool;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const COMMON_IGNORE = new Set([".git", "node_modules", ".codegraph", "dist", "build"]);

function walkFiles(root: string, predicate: (file: string) => boolean): string[] {
  const result: string[] = [];
  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          if (COMMON_IGNORE.has(entry)) continue;
          walk(full);
        } else if (s.isFile() && predicate(full)) {
          result.push(full);
        }
      } catch {
        continue;
      }
    }
  }
  walk(root);
  return result;
}

function readLines(file: string): string[] {
  try {
    return readFileSync(file, "utf-8").split("\n");
  } catch {
    return [];
  }
}

// ─── 1. feature-flag-brain ───────────────────────────────────────────────────

const FEATURE_FLAG_PATTERNS = [
  /(?:feature|flag|toggle|experiment|FF)_[A-Z0-9_]+/gi,
  /featureFlag\[['"]?([^'"\]]+)['"]?\]/g,
  /flags?\.(?:isEnabled|isActive|getValue)\(['"]([^'"]+)['"]\)/g,
  /process\.env\.(?:NEXT_PUBLIC_)?FF_/g,
  /LaunchDarkly|Unleash|Flagsmith|splitio/gi,
];

export const featureFlagBrain: ToolEntry = {
  name: "feature-flag-brain",
  tool: {
    description:
      "Scan source files for feature-flag patterns (env vars, toggle libraries, inline checks). Returns detected flags with file locations and enabled state.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Root directory to scan (default: current working directory)",
        },
      },
    },
    handler: async (args, root) => {
      const dir = (args.directory as string) || root;
      const target = resolve(dir);
      const files = walkFiles(target, (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(extname(f)));

      const flagMap = new Map<string, { locations: string[]; enabled: boolean }>();

      for (const file of files) {
        const lines = readLines(file);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const pattern of FEATURE_FLAG_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(line)) !== null) {
              const flagName = match[1] || match[0];
              const enabled =
                !/false|disabled|off|0/i.test(line) && /true|enabled|on|1/i.test(line);
              const relative = file.replace(target, "").replace(/^\//, "");
              if (!flagMap.has(flagName)) {
                flagMap.set(flagName, { locations: [], enabled });
              }
              flagMap.get(flagName)!.locations.push(`${relative}:${i + 1}`);
            }
          }
        }
      }

      const flags = Array.from(flagMap.entries()).map(([name, data]) => ({
        name,
        locations: data.locations,
        enabled: data.enabled,
      }));

      return { flags };
    },
  },
};

// ─── 2. query-performance-whisperer ──────────────────────────────────────────

const N_PLUS_ONE_PATTERNS = [
  { pattern: /\.findMany\s*\(/g, label: "findMany" },
  { pattern: /\.find\w*\s*\(/g, label: "find" },
  { pattern: /\.query\s*\(/g, label: "query" },
  { pattern: /\.aggregate\s*\(/g, label: "aggregate" },
];

export const queryPerformanceWhisperer: ToolEntry = {
  name: "query-performance-whisperer",
  tool: {
    description:
      "Scan source files for ORM query patterns that may indicate N+1 performance risks (findMany inside loops, repeated queries).",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Root directory to scan (default: current working directory)",
        },
      },
    },
    handler: async (args, root) => {
      const dir = (args.directory as string) || root;
      const target = resolve(dir);
      const files = walkFiles(target, (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(extname(f)));

      const risks: Array<{ file: string; line: number; pattern: string }> = [];

      for (const file of files) {
        const lines = readLines(file);
        const relative = file.replace(target, "").replace(/^\//, "");
        for (let i = 0; i < lines.length; i++) {
          for (const { pattern, label } of N_PLUS_ONE_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(lines[i])) {
              const isInLoop = /(?:for|while|forEach|\.map\s*\(|Promise\.all)/i.test(lines[i]);
              if (isInLoop) {
                risks.push({ file: relative, line: i + 1, pattern: label });
              }
            }
          }
        }
      }

      return { risks };
    },
  },
};

// ─── 3. chaos-predictor ──────────────────────────────────────────────────────

const CATCH_PATTERNS = [/catch\s*\(/g, /\.catch\s*\(/g];

const UNHANDLED_REJECTION_PATTERNS = [/Promise\s*\(/g, /new Promise/g, /\.then\s*\(/g];

export const chaosPredictor: ToolEntry = {
  name: "chaos-predictor",
  tool: {
    description:
      "Scan source files for error-prone catch blocks (bare/empty catches) and unchecked promise rejections (promises without .catch()).",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Root directory to scan (default: current working directory)",
        },
      },
    },
    handler: async (args, root) => {
      const dir = (args.directory as string) || root;
      const target = resolve(dir);
      const files = walkFiles(target, (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(extname(f)));

      const riskyCatches: Array<{ file: string; line: number }> = [];
      const unhandledRejections: Array<{ file: string; line: number }> = [];

      for (const file of files) {
        const lines = readLines(file);
        const relative = file.replace(target, "").replace(/^\//, "");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          for (const pattern of CATCH_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line) && (line.includes("{}") || /catch\s*\)/.test(line))) {
              riskyCatches.push({ file: relative, line: i + 1 });
            }
          }

          for (const pattern of UNHANDLED_REJECTION_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line) && !line.includes(".catch") && !line.includes("await")) {
              const block = lines.slice(i, Math.min(i + 5, lines.length)).join("\n");
              if (!block.includes(".catch")) {
                unhandledRejections.push({ file: relative, line: i + 1 });
              }
            }
          }
        }
      }

      return { riskyCatches, unhandledRejections };
    },
  },
};

// ─── 4. distributed-trace-narrator ───────────────────────────────────────────

export const distributedTraceNarrator: ToolEntry = {
  name: "distributed-trace-narrator",
  tool: {
    description:
      "Read structured JSONL log files and extract trace/span information (trace IDs, span counts, durations).",
    inputSchema: {
      type: "object",
      properties: {
        logPath: {
          type: "string",
          description: "Path to a .jsonl log file or directory containing .jsonl files",
        },
      },
    },
    handler: async (args, root) => {
      const logPath = args.logPath as string | undefined;
      if (!logPath) {
        return {
          message: "No logPath provided. Specify a path to a .jsonl log file or directory.",
        };
      }
      const target = resolve(root, logPath);

      let logFiles: string[];
      if (existsSync(target) && statSync(target).isDirectory()) {
        logFiles = readdirSync(target)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => join(target, f));
      } else if (existsSync(target) && target.endsWith(".jsonl")) {
        logFiles = [target];
      } else {
        return { message: `Path does not exist or is not a .jsonl file: ${logPath}` };
      }

      if (logFiles.length === 0) {
        return { message: "No .jsonl files found at the specified path." };
      }

      const traces: Array<{ traceId: string; spans: number; duration: number }> = [];
      const traceMap = new Map<
        string,
        { spans: number; startTimes: number[]; endTimes: number[] }
      >();

      for (const lf of logFiles) {
        const content = readFileSync(lf, "utf-8");
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            const traceId = entry.traceId || entry.trace_id || entry.trace?.id;
            if (!traceId) continue;

            if (!traceMap.has(traceId)) {
              traceMap.set(traceId, { spans: 0, startTimes: [], endTimes: [] });
            }
            const record = traceMap.get(traceId)!;
            record.spans++;

            if (typeof entry.timestamp === "number") {
              record.startTimes.push(entry.timestamp);
              record.endTimes.push(entry.timestamp);
            } else if (typeof entry.startTime === "number" || typeof entry.endTime === "number") {
              if (typeof entry.startTime === "number") record.startTimes.push(entry.startTime);
              if (typeof entry.endTime === "number") record.endTimes.push(entry.endTime);
            } else if (typeof entry.duration === "number") {
              record.startTimes.push(0);
              record.endTimes.push(entry.duration);
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      }

      for (const [traceId, record] of traceMap) {
        const minStart = record.startTimes.length > 0 ? Math.min(...record.startTimes) : 0;
        const maxEnd = record.endTimes.length > 0 ? Math.max(...record.endTimes) : 0;
        traces.push({ traceId, spans: record.spans, duration: maxEnd - minStart });
      }

      if (traces.length === 0) {
        return { message: "No trace data found in the provided log files." };
      }

      return { traces };
    },
  },
};

// ─── 5. schema-evolution-guardian ────────────────────────────────────────────

export const schemaEvolutionGuardian: ToolEntry = {
  name: "schema-evolution-guardian",
  tool: {
    description:
      "Compare current DB schema (Prisma, TypeORM, raw SQL DDL) against a stored snapshot and report field-level changes.",
    inputSchema: {
      type: "object",
      properties: {
        schemaPath: {
          type: "string",
          description: "Path to the current schema file (e.g. prisma/schema.prisma)",
        },
        snapshotPath: {
          type: "string",
          description: "Path to a previously saved schema snapshot file",
        },
      },
    },
    handler: async (args, root) => {
      const schemaPath = args.schemaPath as string | undefined;
      const snapshotPath = args.snapshotPath as string | undefined;

      if (!schemaPath || !snapshotPath) {
        return { changes: [], message: "Both schemaPath and snapshotPath are required." };
      }

      const schemaFile = resolve(root, schemaPath);
      const snapshotFile = resolve(root, snapshotPath);

      if (!existsSync(schemaFile)) {
        return { changes: [], message: `Schema file not found: ${schemaPath}` };
      }
      if (!existsSync(snapshotFile)) {
        return { changes: [], message: `Snapshot file not found: ${snapshotPath}` };
      }

      const schemaLines = readLines(schemaFile);
      const snapshotLines = readLines(snapshotFile);
      const changes: Array<{ field: string; type: string; change: string }> = [];

      function parseSchema(lines: string[]): Map<string, Map<string, string>> {
        const models = new Map<string, Map<string, string>>();
        let currentModel: string | null = null;
        for (const line of lines) {
          const modelMatch = line.match(/^\s*(?:model|table|entity)\s+(\w+)\s*\{/i);
          if (modelMatch) {
            currentModel = modelMatch[1];
            models.set(currentModel, new Map());
            continue;
          }
          if (currentModel && /^\s*}\s*$/.test(line)) {
            currentModel = null;
            continue;
          }
          if (currentModel) {
            const fieldMatch = line.match(/^\s+(\w+)\s+(\S+)/);
            if (fieldMatch && !line.trim().startsWith("@@")) {
              models.get(currentModel)!.set(fieldMatch[1], fieldMatch[2]);
            }
          }
        }
        return models;
      }

      const schemaModels = parseSchema(schemaLines);
      const snapshotModels = parseSchema(snapshotLines);
      const allModels = new Set([...schemaModels.keys(), ...snapshotModels.keys()]);

      for (const model of allModels) {
        const schemaFields = schemaModels.get(model);
        const snapshotFields = snapshotModels.get(model);

        if (!schemaFields) {
          changes.push({ field: `${model} (model)`, type: "model", change: "removed" });
          continue;
        }
        if (!snapshotFields) {
          changes.push({ field: `${model} (model)`, type: "model", change: "added" });
          continue;
        }

        const allFields = new Set([...schemaFields.keys(), ...snapshotFields.keys()]);
        for (const field of allFields) {
          const schemaType = schemaFields.get(field);
          const snapshotType = snapshotFields.get(field);

          if (schemaType && !snapshotType) {
            changes.push({ field: `${model}.${field}`, type: schemaType, change: "added" });
          } else if (!schemaType && snapshotType) {
            changes.push({ field: `${model}.${field}`, type: snapshotType, change: "removed" });
          } else if (schemaType !== snapshotType) {
            changes.push({
              field: `${model}.${field}`,
              type: `${snapshotType} -> ${schemaType}`,
              change: "modified",
            });
          }
        }
      }

      return { changes };
    },
  },
};

// ─── 6. event-storm-mapper ───────────────────────────────────────────────────

const EMITTER_PATTERNS = [/\.emit\s*\(/g, /\.publish\s*\(/g, /EventEmitter/g];
const LISTENER_PATTERNS = [
  /\.on\s*\(/g,
  /\.subscribe\s*\(/g,
  /\.addListener\s*\(/g,
  /\.once\s*\(/g,
];

export const eventStormMapper: ToolEntry = {
  name: "event-storm-mapper",
  tool: {
    description:
      "Scan source files for event emitter patterns (emit, on, publish, subscribe) and map event names to their emitters and listeners.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Root directory to scan (default: current working directory)",
        },
      },
    },
    handler: async (args, root) => {
      const dir = (args.directory as string) || root;
      const target = resolve(dir);
      const files = walkFiles(target, (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(extname(f)));

      const eventMap = new Map<string, { emitters: string[]; listeners: string[] }>();

      for (const file of files) {
        const lines = readLines(file);
        const relative = file.replace(target, "").replace(/^\//, "");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const eventNameMatch = line.match(/['"]([^'"]+)['"]/);

          for (const pattern of EMITTER_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line) && eventNameMatch) {
              const eventName = eventNameMatch[1];
              if (!eventMap.has(eventName)) {
                eventMap.set(eventName, { emitters: [], listeners: [] });
              }
              eventMap.get(eventName)!.emitters.push(`${relative}:${i + 1}`);
            }
          }

          for (const pattern of LISTENER_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line) && eventNameMatch) {
              const eventName = eventNameMatch[1];
              if (!eventMap.has(eventName)) {
                eventMap.set(eventName, { emitters: [], listeners: [] });
              }
              eventMap.get(eventName)!.listeners.push(`${relative}:${i + 1}`);
            }
          }
        }
      }

      const events = Array.from(eventMap.entries()).map(([eventName, data]) => ({
        eventName,
        emitters: data.emitters,
        listeners: data.listeners,
      }));

      return { events };
    },
  },
};

// ─── 7. migration-complexity-estimator ───────────────────────────────────────

export const migrationComplexityEstimator: ToolEntry = {
  name: "migration-complexity-estimator",
  tool: {
    description:
      "Analyze SQL migration files for size, statement count, and structural complexity, rating each as low/medium/high.",
    inputSchema: {
      type: "object",
      properties: {
        migrationsDir: {
          type: "string",
          description:
            "Directory containing SQL migration files (default: prisma/migrations or db/migrations)",
        },
      },
    },
    handler: async (args, root) => {
      const migrationsDir = resolve(root, (args.migrationsDir as string) || "prisma/migrations");

      if (!existsSync(migrationsDir)) {
        return {
          migrations: [],
          message: `Migrations directory not found: ${migrationsDir}`,
        };
      }

      const migrationFiles: string[] = [];
      function collectSqlFiles(dir: string) {
        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = join(dir, entry);
          try {
            const s = statSync(full);
            if (s.isDirectory()) {
              collectSqlFiles(full);
            } else if (s.isFile() && /\.sql$/i.test(entry)) {
              migrationFiles.push(full);
            }
          } catch {
            continue;
          }
        }
      }
      collectSqlFiles(migrationsDir);

      const migrations = migrationFiles.map((file) => {
        const content = readFileSync(file, "utf-8");
        const size = content.length;
        const stripped = content
          .replace(/'(?:[^'\\]|\\.)*'/g, "")
          .replace(/"(?:[^"\\]|\\.)*"/g, "");
        const statements = (stripped.match(/;/g) || []).length;

        let complexity: "low" | "medium" | "high";
        const structuralScore =
          statements +
          (content.match(/ALTER\s+TABLE/gi) || []).length * 2 +
          (content.match(/CREATE\s+(?:INDEX|TRIGGER|FUNCTION|PROCEDURE)/gi) || []).length * 3 +
          (content.match(/DROP\s+(?:TABLE|INDEX|COLUMN)/gi) || []).length * 2 +
          (content.match(/FOREIGN\s+KEY/gi) || []).length;

        if (structuralScore <= 5 && size <= 2000) {
          complexity = "low";
        } else if (structuralScore <= 15 && size <= 10000) {
          complexity = "medium";
        } else {
          complexity = "high";
        }

        const relative = file.replace(migrationsDir, "").replace(/^\//, "");
        return { file: relative, size, statements, complexity };
      });

      return { migrations };
    },
  },
};
