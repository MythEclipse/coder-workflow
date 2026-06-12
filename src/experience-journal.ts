#!/usr/bin/env node
/**
 * Experience Journal — Track task completions, failures, and decisions
 * for continuous learning.
 *
 * Stores data in .claude/experience-journal/entries.jsonl and decisions.jsonl
 * using JSONL format (one JSON object per line).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ExperienceOutcome,
  ExperienceEntry,
  DecisionRecord,
  Stats,
} from "./experience-types.js";
import { ensureDir } from "./utils/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Journal storage directory. */
const JOURNAL_DIR = ".claude/experience-journal";

/** Entries record file. */
const ENTRIES_FILE = "entries.jsonl";

/** Decisions record file. */
const DECISIONS_FILE = "decisions.jsonl";

/** Default maximum query results. */
const DEFAULT_QUERY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensures the journal directory exists. Creates it if it doesn't.
 *
 * @returns {string} Absolute path to the journal directory
 */
function ensureJournalDir(): string {
  return ensureDir(resolve(join(process.cwd(), JOURNAL_DIR)));
}

/**
 * Generates a unique ID.
 *
 * @param {string} prefix — ID prefix
 * @returns {string} Unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Parses an ISO timestamp to epoch milliseconds.
 *
 * @param {string} iso — ISO 8601 timestamp
 * @returns {number} Epoch milliseconds
 */
function parseTimestamp(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// ---------------------------------------------------------------------------
// Read & Write JSONL
// ---------------------------------------------------------------------------

/**
 * Reads all records from a JSONL file.
 *
 * @template T — Record type
 * @param {string} filePath — Path to JSONL file
 * @returns {T[]} Array of records
 */
function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const records: T[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as T);
      } catch {
        // skip corrupted lines
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Appends one record to a JSONL file.
 *
 * @param {string} filePath — Path to JSONL file
 * @param {unknown} record — Record to save
 * @returns {boolean} true if successful
 */
function appendJsonl(filePath: string, record: unknown): boolean {
  try {
    appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public Functions: Record
// ---------------------------------------------------------------------------

/**
 * Records a task completion in the journal.
 * Logs the outcome, lessons, patterns, and decisions made.
 *
 * @param {Omit<ExperienceEntry, "id" | "timestamp">} task — Task completion data without id and timestamp
 * @returns {ExperienceEntry} Entry complete with ID and timestamp
 *
 * @example
 * ```ts
 * recordCompletion({
 *   taskType: "implement",
 *   taskDesc: "Create REST API for user auth",
 *   outcome: "success",
 *   lessons: ["Refresh token needs longer expiry"],
 *   patterns: ["auth-middleware-pattern"],
 *   decisions: [],
 *   tags: ["auth", "rest-api"]
 * });
 * ```
 */
export function recordCompletion(task: Omit<ExperienceEntry, "id" | "timestamp">): ExperienceEntry {
  const dir = ensureJournalDir();
  const entry: ExperienceEntry = {
    ...task,
    id: generateId("exp"),
    timestamp: new Date().toISOString(),
  };

  appendJsonl(join(dir, ENTRIES_FILE), entry);

  // Also record decisions to the decisions file
  if (task.decisions && task.decisions.length > 0) {
    const decisionsFile = join(dir, DECISIONS_FILE);
    for (const decision of task.decisions) {
      appendJsonl(decisionsFile, decision);
    }
  }

  return entry;
}

/**
 * Records a task failure in the journal.
 * Useful for quick logging from catch blocks.
 *
 * @param {string} taskType — Task type (e.g., "implement", "debug", "deploy")
 * @param {string} error — Error message or failure description
 * @param {string} context — Context where the failure occurred
 * @returns {ExperienceEntry} The created entry
 *
 * @example
 * ```ts
 * try {
 *   await deploy();
 * } catch (err) {
 *   recordFailure("deploy", err.message, "Deployment to staging");
 * }
 * ```
 */
export function recordFailure(taskType: string, error: string, context: string): ExperienceEntry {
  const dir = ensureJournalDir();
  const entry: ExperienceEntry = {
    id: generateId("exp"),
    timestamp: new Date().toISOString(),
    taskType,
    taskDesc: context,
    outcome: "failure",
    rootCause: error,
    lessons: [`Failure in ${taskType}: ${error}`],
    patterns: [],
    decisions: [],
    tags: [taskType, "failure"],
  };

  appendJsonl(join(dir, ENTRIES_FILE), entry);

  return entry;
}

/**
 * Records an architectural or technical decision.
 * The decision is saved to decisions.jsonl and can be queried later.
 *
 * @param {string} context — Decision context
 * @param {string[]} options — Options that were considered
 * @param {string} selected — The selected option
 * @param {string} rationale — Reason for selection
 * @returns {DecisionRecord} The saved decision record
 *
 * @example
 * ```ts
 * recordDecision(
 *   "Choose HTTP client library",
 *   ["axios", "node-fetch", "undici"],
 *   "undici",
 *   "Built-in Node.js, better performance, smaller bundle size"
 * );
 * ```
 */
export function recordDecision(
  context: string,
  options: string[],
  selected: string,
  rationale: string,
): DecisionRecord {
  const dir = ensureJournalDir();
  const record: DecisionRecord = {
    id: generateId("dec"),
    timestamp: new Date().toISOString(),
    context,
    options,
    selected,
    rationale,
  };

  appendJsonl(join(dir, DECISIONS_FILE), record);

  return record;
}

// ---------------------------------------------------------------------------
// Public Functions: Query
// ---------------------------------------------------------------------------

/**
 * Queries recent task experiences, optionally filtered by task type.
 *
 * @param {string} [taskType] — Filter by task type (optional)
 * @param {number} [limit=10] — Maximum number of results
 * @returns {ExperienceEntry[]} Array of matching entries, sorted by newest first
 *
 * @example
 * ```ts
 * // Get the 5 most recent debug tasks
 * const debugTasks = queryRecent("debug", 5);
 *
 * // Get all recent tasks
 * const recent = queryRecent();
 * ```
 */
export function queryRecent(
  taskType?: string,
  limit: number = DEFAULT_QUERY_LIMIT,
): ExperienceEntry[] {
  const dir = ensureJournalDir();
  const allEntries = readJsonl<ExperienceEntry>(join(dir, ENTRIES_FILE));

  let filtered = allEntries;

  if (taskType) {
    const tt = taskType.toLowerCase();
    filtered = filtered.filter((e) => e.taskType.toLowerCase() === tt);
  }

  // Sort by newest first
  filtered.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

  return filtered.slice(0, limit);
}

/**
 * Queries past decisions by context.
 * Useful when facing similar decisions and wanting to see
 * what was chosen previously and why.
 *
 * @param {string} [context] — Filter by context (partial match, case-insensitive, optional)
 * @returns {DecisionRecord[]} Array of matching decisions, sorted by newest first
 *
 * @example
 * ```ts
 * // Find all decisions about database
 * const dbDecisions = queryDecisions("database");
 * ```
 */
export function queryDecisions(context?: string): DecisionRecord[] {
  const dir = ensureJournalDir();
  const allDecisions = readJsonl<DecisionRecord>(join(dir, DECISIONS_FILE));

  let filtered = allDecisions;

  if (context) {
    const search = context.toLowerCase();
    filtered = filtered.filter(
      (d) =>
        d.context.toLowerCase().includes(search) ||
        d.selected.toLowerCase().includes(search) ||
        d.rationale.toLowerCase().includes(search) ||
        d.options.some((o) => o.toLowerCase().includes(search)),
    );
  }

  // Sort by newest first
  filtered.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

  return filtered;
}

/**
 * Gets memories that have not yet been processed by the Dreaming phase.
 */
export function getUnprocessedMemories(): ExperienceEntry[] {
  const dir = ensureJournalDir();
  const allEntries = readJsonl<ExperienceEntry>(join(dir, ENTRIES_FILE));

  return allEntries.filter((e) => !e.dreamedAt);
}

/**
 * Marks specific memories as processed by the Dreaming phase.
 */
export function markAsDreamed(ids: string[]): boolean {
  const dir = ensureJournalDir();
  const logPath = join(dir, ENTRIES_FILE);
  if (!existsSync(logPath)) return false;

  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  let updatedCount = 0;

  const updated = lines.map((line) => {
    try {
      const record = JSON.parse(line) as ExperienceEntry;
      if (ids.includes(record.id) && !record.dreamedAt) {
        record.dreamedAt = new Date().toISOString();
        updatedCount++;
      }
      return JSON.stringify(record);
    } catch {
      return line;
    }
  });

  writeFileSync(logPath, updated.join("\n") + "\n", "utf-8");
  return updatedCount > 0;
}

// ---------------------------------------------------------------------------
// Public Functions: Analysis
// ---------------------------------------------------------------------------

/**
 * Extracts patterns and success rates from the journal.
 * Identifies which patterns frequently succeed and which frequently fail.
 *
 * @returns {Array<{ pattern: string; frequency: number; avgSuccessRate: number }>}
 *   Array of pattern insights, sorted by most frequent
 *
 * @example
 * ```ts
 * const insights = getInsights();
 * const best = insights[0];
 * ```
 */
export function getInsights(): Array<{
  pattern: string;
  frequency: number;
  avgSuccessRate: number;
}> {
  const dir = ensureJournalDir();
  const allEntries = readJsonl<ExperienceEntry>(join(dir, ENTRIES_FILE));

  const patternMap = new Map<string, { total: number; successes: number; partials: number }>();

  for (const entry of allEntries) {
    for (const pattern of entry.patterns) {
      const key = pattern.toLowerCase().trim();
      if (!key) continue;

      if (!patternMap.has(key)) {
        patternMap.set(key, { total: 0, successes: 0, partials: 0 });
      }

      const stats = patternMap.get(key)!;
      stats.total += 1;

      if (entry.outcome === "success") stats.successes += 1;
      else if (entry.outcome === "partial") stats.partials += 1;
    }
  }

  const insights: Array<{
    pattern: string;
    frequency: number;
    avgSuccessRate: number;
  }> = [];

  for (const [pattern, stats] of patternMap) {
    const successRate =
      stats.total > 0 ? (stats.successes + stats.partials * 0.5) / stats.total : 0;

    insights.push({
      pattern,
      frequency: stats.total,
      avgSuccessRate: Math.round(successRate * 100) / 100,
    });
  }

  // Sort by frequency descending
  insights.sort((a, b) => b.frequency - a.frequency);

  return insights;
}

// ---------------------------------------------------------------------------
// Public Functions: Statistics
// ---------------------------------------------------------------------------

/**
 * Gets summary statistics from the journal.
 * Includes total entries, per-outcome breakdown, top patterns, and recent decisions.
 *
 * @returns {Stats} Statistics object
 *
 * @example
 * ```ts
 * const stats = getStats();
 * console.log(`Total: ${stats.total}, Failed: ${stats.byOutcome.failure}`);
 * ```
 */
export function getStats(): Stats {
  const dir = ensureJournalDir();
  const allEntries = readJsonl<ExperienceEntry>(join(dir, ENTRIES_FILE));
  const allDecisions = readJsonl<DecisionRecord>(join(dir, DECISIONS_FILE));

  const byOutcome: Record<ExperienceOutcome, number> = {
    success: 0,
    failure: 0,
    partial: 0,
  };

  for (const entry of allEntries) {
    if (byOutcome[entry.outcome] !== undefined) {
      byOutcome[entry.outcome] += 1;
    }
  }

  const topPatterns = getInsights().slice(0, 10);

  const recentDecisions = [...allDecisions]
    .sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp))
    .slice(0, 10);

  return {
    total: allEntries.length,
    byOutcome,
    topPatterns,
    recentDecisions,
  };
}

// ---------------------------------------------------------------------------
// Public Functions: Format
// ---------------------------------------------------------------------------

/**
 * Formats journal statistics into a human-readable Markdown string.
 *
 * @param {Stats} stats — Statistics object from getStats()
 * @returns {string} Markdown formatted report string
 *
 * @example
 * ```ts
 * const stats = getStats();
 * console.log(formatReport(stats));
 * ```
 */
export function formatReport(stats: Stats): string {
  const lines: string[] = [];

  lines.push("# Experience Journal Report");
  lines.push("");
  lines.push(`**Total entries:** ${stats.total}`);
  lines.push("");

  // Breakdown per outcome
  lines.push("## Breakdown per Outcome");
  lines.push("| Outcome | Count |");
  lines.push("|---------|--------|");
  const outcomeOrder: ExperienceOutcome[] = ["success", "partial", "failure"];
  for (const outcome of outcomeOrder) {
    const count = stats.byOutcome[outcome] ?? 0;
    const pct = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : "0.0";
    lines.push(`| ${outcome} | ${count} (${pct}%) |`);
  }
  lines.push("");

  // Top patterns
  if (stats.topPatterns.length > 0) {
    lines.push("## Top Patterns");
    lines.push("| Pattern | Frequency | Avg Success Rate |");
    lines.push("|------|-----------|------------------|");
    for (const p of stats.topPatterns) {
      const pct = (p.avgSuccessRate * 100).toFixed(0);
      lines.push(`| ${p.pattern} | ${p.frequency}x | ${pct}% |`);
    }
    lines.push("");
  }

  // Recent decisions
  if (stats.recentDecisions.length > 0) {
    lines.push("## Recent Decisions");
    lines.push("| Context | Selected | Date |");
    lines.push("|---------|---------|---------|");
    for (const d of stats.recentDecisions) {
      const date = new Date(d.timestamp).toLocaleDateString("id-ID", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const context = d.context.replace(/\|/g, "\\|");
      const selected = d.selected.replace(/\|/g, "\\|");
      lines.push(`| ${context} | ${selected} | ${date} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
