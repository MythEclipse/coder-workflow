#!/usr/bin/env node
/**
 * headroom learn — Self-Improving Failure Analysis
 *
 * Inspired by Headroom's `headroom learn` feature.
 * Analyzes failed sessions/tool calls and writes corrections
 * to memory files so the system improves over time.
 *
 * Architecture:
 * 1. Hook captures StopFailure / PostToolUseFailure events
 * 2. learn module logs the failure with context
 * 3. On demand: analyze failures → extract patterns → write corrections
 * 4. Corrections stored as memory files read back on future sessions
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CorrectionEntry, FailureRecord, LearnReport } from "./experience-types.js";

// In-process guard: prevents concurrent dreaming cycles from racing on the same file.
// A simple boolean is sufficient because Node.js is single-threaded per process.
let _dreamingInProgress = false;

// ─── Constants ───────────────────────────────────────────────────────────

const LEARN_DIR = ".claude/learn";
const FAILURE_LOG = "failures.jsonl";
const CORRECTIONS_FILE = "corrections.json";

// ─── Failure Logging ────────────────────────────────────────────────────

function ensureLearnDir(): string {
  const dir = join(process.cwd(), LEARN_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Log a failure event to the failure log.
 * Called by StopFailure and PostToolUseFailure hooks.
 */
export async function logFailure(
  record: Omit<FailureRecord, "id" | "timestamp" | "resolved">,
): Promise<FailureRecord> {
  const dir = ensureLearnDir();
  const fullRecord: FailureRecord = {
    ...record,
    id: `${record.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    resolved: false,
  };

  appendFileSync(join(dir, FAILURE_LOG), JSON.stringify(fullRecord) + "\n", "utf-8");

  // Auto-trigger dreaming if backlog gets too large (dynamic import to avoid circular dep).
  // Guard with _dreamingInProgress to prevent concurrent fire-and-forget races when
  // multiple failures arrive in rapid succession (e.g., batch async hooks).
  try {
    if (!_dreamingInProgress && getUnprocessedFailures().length >= 5) {
      _dreamingInProgress = true;
      const { runDreamingCycle } = await import("./dreaming.js");
      Promise.resolve(runDreamingCycle()).finally(() => {
        _dreamingInProgress = false;
      });
    }
  } catch {
    _dreamingInProgress = false;
    // Fail silently — dreaming is best-effort
  }

  return fullRecord;
}

/**
 * Read all failure records, optionally filtered by type.
 */
export function getFailures(options?: {
  type?: FailureRecord["type"];
  unresolved?: boolean;
  limit?: number;
}): FailureRecord[] {
  const dir = ensureLearnDir();
  const logPath = join(dir, FAILURE_LOG);

  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  const failures: FailureRecord[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as FailureRecord;
      if (options?.type && record.type !== options.type) continue;
      if (options?.unresolved && record.resolved) continue;
      failures.push(record);
    } catch {
      // skip corrupted lines
    }
  }

  // Sort by timestamp descending (newest first)
  failures.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return options?.limit ? failures.slice(0, options.limit) : failures;
}

/**
 * Gets failures that have not yet been processed by the Dreaming phase.
 */
export function getUnprocessedFailures(): FailureRecord[] {
  const dir = ensureLearnDir();
  const logPath = join(dir, FAILURE_LOG);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  const failures: FailureRecord[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as FailureRecord;
      if (!record.dreamedAt) {
        failures.push(record);
      }
    } catch {
      // skip corrupted lines
    }
  }

  failures.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return failures;
}

/**
 * Marks specific failures as processed by the Dreaming phase.
 */
export function markFailureAsDreamed(ids: string[]): boolean {
  const dir = ensureLearnDir();
  const logPath = join(dir, FAILURE_LOG);
  if (!existsSync(logPath)) return false;

  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  let updatedCount = 0;

  const updated = lines.map((line) => {
    try {
      const record = JSON.parse(line) as FailureRecord;
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

// ─── Correction Management ──────────────────────────────────────────────

function correctionReplacer(_key: string, value: unknown): unknown {
  if (value instanceof RegExp) {
    return { __regexp: true, source: value.source, flags: value.flags };
  }
  return value;
}

function correctionReviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__regexp === true
  ) {
    const raw = value as Record<string, unknown>;
    // Guard: source and flags must be non-empty strings before constructing RegExp.
    // A corrupted or manually-written corrections.json could omit these fields,
    // leading to new RegExp(undefined) which silently compiles to /(?:)/.
    if (typeof raw.source !== "string" || raw.source.length === 0) {
      return /(?:)/; // safe no-op pattern instead of silent wrong behavior
    }
    const flags = typeof raw.flags === "string" ? raw.flags : "";
    try {
      return new RegExp(raw.source, flags);
    } catch {
      // If the stored source is syntactically invalid, return a no-op pattern.
      return /(?:)/;
    }
  }
  return value;
}

function loadCorrections(): CorrectionEntry[] {
  const dir = ensureLearnDir();
  const filePath = join(dir, CORRECTIONS_FILE);
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"), correctionReviver);
  } catch {
    return [];
  }
}

function saveCorrections(corrections: CorrectionEntry[]): void {
  const dir = ensureLearnDir();
  writeFileSync(
    join(dir, CORRECTIONS_FILE),
    JSON.stringify(corrections, correctionReplacer, 2),
    "utf-8",
  );
}

function getGlobalCorrectionsPath(): string {
  if (process.env.TEST_GLOBAL_CORRECTIONS_PATH) {
    return process.env.TEST_GLOBAL_CORRECTIONS_PATH;
  }
  const dir = join(homedir(), ".coder-workflow");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "global-corrections.json");
}

function loadGlobalCorrections(): CorrectionEntry[] {
  const filePath = getGlobalCorrectionsPath();
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"), correctionReviver);
  } catch {
    return [];
  }
}

function saveGlobalCorrections(corrections: CorrectionEntry[]): void {
  writeFileSync(
    getGlobalCorrectionsPath(),
    JSON.stringify(corrections, correctionReplacer, 2),
    "utf-8",
  );
}

/**
 * Add a new correction pattern from a failure analysis.
 */
export function addCorrection(
  pattern: string,
  symptomPattern: string,
  fix: string,
): CorrectionEntry {
  const corrections = loadCorrections();
  const entry: CorrectionEntry = {
    id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    pattern,
    symptom: new RegExp(symptomPattern, "i"),
    fix,
    source: "learn",
    createdAt: new Date().toISOString(),
    appliedCount: 0,
  };

  corrections.push(entry);
  saveCorrections(corrections);
  return entry;
}

/**
 * Find a correction that matches a given error string.
 * Also applies decay/punishment logic: if the correction was applied very recently
 * and is matching again, it indicates the fix failed. If it fails > 3 times rapidly,
 * it is revoked (deleted).
 */
export function matchCorrection(error: string): CorrectionEntry | undefined {
  const local = loadCorrections();
  const global = loadGlobalCorrections();
  const all = [...local, ...global];

  let matched: CorrectionEntry | undefined;
  let isGlobal = false;

  for (const corr of all) {
    try {
      if (corr.symptom.test(error)) {
        matched = corr;
        isGlobal = global.some((c) => c.id === corr.id);
        break;
      }
    } catch {
      // bad regex, skip
    }
  }

  if (matched) {
    // Punishment logic
    if (matched.lastAppliedAt) {
      const msSince = Date.now() - new Date(matched.lastAppliedAt).getTime();
      if (msSince < 120000) {
        // 2 minutes
        matched.failureCount = (matched.failureCount || 0) + 1;
        if (matched.failureCount > 3) {
          // Revoke correction
          if (isGlobal) {
            saveGlobalCorrections(loadGlobalCorrections().filter((c) => c.id !== matched!.id));
          } else {
            saveCorrections(loadCorrections().filter((c) => c.id !== matched!.id));
          }
          return undefined;
        }
      } else {
        matched.failureCount = 0; // reset if enough time passed
      }

      // Save the updated failureCount
      if (isGlobal) {
        const globals = loadGlobalCorrections();
        const idx = globals.findIndex((c) => c.id === matched!.id);
        if (idx !== -1) {
          globals[idx] = matched;
          saveGlobalCorrections(globals);
        }
      } else {
        const locals = loadCorrections();
        const idx = locals.findIndex((c) => c.id === matched!.id);
        if (idx !== -1) {
          locals[idx] = matched;
          saveCorrections(locals);
        }
      }
    }
  }

  return matched;
}

/**
 * Increment the applied count for a correction by id, and record lastAppliedAt.
 * Call this after you have confirmed a correction was used, separate from lookup.
 */
export function incrementAppliedCount(correctionId: string): boolean {
  let found = false;

  const locals = loadCorrections();
  const localIdx = locals.findIndex((c) => c.id === correctionId);
  if (localIdx !== -1) {
    locals[localIdx].appliedCount++;
    locals[localIdx].lastAppliedAt = new Date().toISOString();
    saveCorrections(locals);
    found = true;
  }

  const globals = loadGlobalCorrections();
  const globalIdx = globals.findIndex((c) => c.id === correctionId);
  if (globalIdx !== -1) {
    globals[globalIdx].appliedCount++;
    globals[globalIdx].lastAppliedAt = new Date().toISOString();
    saveGlobalCorrections(globals);
    found = true;
  }

  return found;
}

// ─── Failure Analysis (Auto-Learn) ──────────────────────────────────────

/**
 * Analyze recent failures and auto-generate corrections.
 * Returns suggested corrections as structured data.
 *
 * This mimics Headroom's `headroom learn` — mining failed sessions
 * and writing corrections to documentation/memory.
 */
export function analyzeFailures(): {
  analyzed: number;
  suggestions: Array<{ pattern: string; symptom: string; fix: string }>;
} {
  // Use getUnprocessedFailures() — only failures not yet processed by the Dreaming
  // phase. getFailures({unresolved:true}) was wrong: dreaming only sets `dreamedAt`,
  // never `resolved`, so all failures would always appear as "unresolved",
  // causing repetitive suggestions every time analyze runs.
  const failures = getUnprocessedFailures().slice(0, 50);
  const suggestions: Array<{ pattern: string; symptom: string; fix: string }> = [];

  if (failures.length === 0) {
    return { analyzed: 0, suggestions: [] };
  }

  // Group similar failures by error message prefix
  const groups = new Map<string, FailureRecord[]>();
  for (const f of failures) {
    if (!f.error) continue;
    // Normalize digits so "timeout after 30s" and "timeout after 60s" group together
    // Use first 80 chars of normalized error as grouping key
    const normalized = f.error.replace(/\d+/g, "0");
    const key = normalized.slice(0, 80);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  // For groups with 2+ similar failures, suggest a correction
  for (const [errorPrefix, group] of groups) {
    if (group.length < 2) continue;

    const toolContext = [...new Set(group.map((f) => f.tool).filter(Boolean))].join(", ");

    // Generate pattern name from error
    const patternName = errorPrefix
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .split(/\s+/)
      .slice(0, 5)
      .join("_")
      .toLowerCase()
      .replace(/_+/g, "_")
      .slice(0, 60);

    const symptom = group[0].error?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").slice(0, 100) || "";

    let fix = "";
    if (errorPrefix.toLowerCase().includes("timeout")) {
      fix = "Increase timeout or reduce operation scope. Consider breaking into smaller steps.";
    } else if (
      errorPrefix.toLowerCase().includes("not found") ||
      errorPrefix.toLowerCase().includes("enoent")
    ) {
      fix = "Ensure path exists before access. Use existsSync() check or try/catch.";
    } else if (
      errorPrefix.toLowerCase().includes("rate limit") ||
      errorPrefix.toLowerCase().includes("429")
    ) {
      fix = "Add exponential backoff between retries. Wait at least 60s before retry.";
    } else if (
      errorPrefix.toLowerCase().includes("permission") ||
      errorPrefix.toLowerCase().includes("denied")
    ) {
      fix = "Add required permission to settings or use an alternative tool.";
    } else if (
      errorPrefix.toLowerCase().includes("parse") ||
      errorPrefix.toLowerCase().includes("syntax")
    ) {
      fix = "Validate input format before processing. Use try/catch with graceful fallback.";
    } else {
      fix = `Investigate recurring error in ${toolContext || "unknown context"}. Check logs for details.`;
    }

    suggestions.push({
      pattern: patternName || `recurring_error_${group.length}`,
      symptom,
      fix,
    });
  }

  return { analyzed: failures.length, suggestions };
}

/**
 * Apply suggested corrections from analysis.
 * Writes to memory files for future sessions.
 */
export function applyCorrections(
  suggestions: Array<{ pattern: string; symptom: string; fix: string }>,
): { written: number; memoryFiles: string[] } {
  const memoryDir = join(process.cwd(), ".claude", "learn", "memory");
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  let written = 0;
  const memoryFiles: string[] = [];

  // Load existing corrections once to deduplicate by pattern name.
  // Without this check, repeated `learn-analyze --apply` on the same failure set
  // would append new CorrectionEntry objects with fresh IDs for identical patterns,
  // growing corrections.json unboundedly.
  const existingCorrections = loadCorrections();
  const existingPatterns = new Set(existingCorrections.map((c) => c.pattern));

  for (const suggestion of suggestions) {
    if (!suggestion.pattern) continue;

    // Skip if a correction for this pattern already exists — update memory file only.
    let entry: CorrectionEntry;
    if (existingPatterns.has(suggestion.pattern)) {
      // Reuse existing entry; update the fix in-place if it differs.
      const existing = existingCorrections.find((c) => c.pattern === suggestion.pattern)!;
      if (existing.fix !== suggestion.fix) {
        existing.fix = suggestion.fix;
        saveCorrections(existingCorrections);
      }
      entry = existing;
    } else {
      entry = addCorrection(suggestion.pattern, suggestion.symptom, suggestion.fix);
      existingPatterns.add(suggestion.pattern);
    }
    const filePath = join(memoryDir, `${suggestion.pattern}.md`);
    const content = [
      "---",
      `name: learn-${suggestion.pattern}`,
      `description: Auto-learned correction for recurring failure: ${suggestion.symptom.slice(0, 80)}`,
      "metadata:",
      "  type: feedback",
      "  source: learn",
      `  correctionId: ${entry.id}`,
      `  createdAt: ${entry.createdAt}`,
      "---",
      "",
      `## Correction: ${suggestion.pattern}`,
      "",
      `**Symptom:** ${suggestion.symptom}`,
      "",
      `**Fix:** ${suggestion.fix}`,
      "",
      `**Why:** This pattern was detected multiple times (≥2 similar failures) and auto-learned.`,
      "",
      `**How to apply:** Refer to this correction when similar errors occur.`,
    ].join("\n");

    writeFileSync(filePath, content, "utf-8");
    written++;
    memoryFiles.push(filePath);
  }

  // Sync to global corrections
  if (written > 0) {
    const globals = loadGlobalCorrections();
    const globalPatterns = new Set(globals.map((c) => c.pattern));
    let globalUpdated = false;

    // Use loadCorrections to get the fully constructed local entries with regex objects
    const locals = loadCorrections();

    for (const suggestion of suggestions) {
      if (!suggestion.pattern) continue;
      const localEntry = locals.find((c) => c.pattern === suggestion.pattern);
      if (!localEntry) continue;

      if (globalPatterns.has(suggestion.pattern)) {
        const existing = globals.find((c) => c.pattern === suggestion.pattern)!;
        if (existing.fix !== suggestion.fix) {
          existing.fix = suggestion.fix;
          globalUpdated = true;
        }
      } else {
        globals.push(localEntry);
        globalPatterns.add(suggestion.pattern);
        globalUpdated = true;
      }
    }

    if (globalUpdated) {
      saveGlobalCorrections(globals);
    }
  }

  // Also write a summary memory file
  if (written > 0) {
    const summaryPath = join(memoryDir, "_learn-summary.md");
    writeFileSync(
      summaryPath,
      [
        "---",
        "name: learn-summary",
        "description: Summary of all auto-learned corrections from failure analysis",
        "metadata:",
        "  type: feedback",
        "  source: learn",
        `  updatedAt: ${new Date().toISOString()}`,
        "---",
        "",
        "# Auto-Learned Corrections",
        "",
        `Total corrections: ${written}`,
        "",
        loadCorrections()
          .filter((c) => c.source === "learn")
          .map((c) => `- **${c.pattern}**: ${c.fix} (applied ${c.appliedCount}x)`)
          .join("\n"),
        "",
        "---",
        "*Generated by headroom learn — failure analysis engine*",
      ].join("\n"),
      "utf-8",
    );
    memoryFiles.push(summaryPath);
  }

  return { written, memoryFiles };
}

/**
 * Get a full learn report for display.
 */
export function getLearnReport(): LearnReport {
  const allFailures = getFailures();
  const unresolved = getFailures({ unresolved: true });
  const corrections = loadCorrections();
  const recent = getFailures({ limit: 10 });

  return {
    totalFailures: allFailures.length,
    unresolvedFailures: unresolved.length,
    correctionsWritten: corrections.filter((c) => c.source === "learn").length,
    activePatterns: corrections.length,
    recentFailures: recent,
  };
}

/**
 * Mark a failure as resolved.
 */
export function resolveFailure(id: string, resolution?: string): boolean {
  const dir = ensureLearnDir();
  const logPath = join(dir, FAILURE_LOG);
  if (!existsSync(logPath)) return false;

  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  let found = false;

  const updated = lines.map((line) => {
    try {
      const record = JSON.parse(line) as FailureRecord;
      if (record.id === id) {
        record.resolved = true;
        record.resolution = resolution;
        found = true;
      }
      return JSON.stringify(record);
    } catch {
      return line;
    }
  });

  writeFileSync(logPath, updated.join("\n") + "\n", "utf-8");
  return found;
}
