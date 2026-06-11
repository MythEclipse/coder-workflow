#!/usr/bin/env node
/**
 * Preflight Checklist — Kesiapan Sebelum Tugas Koding
 *
 * Menjalankan serangkaian pemeriksaan (readiness checks) untuk memastikan
 * environment siap sebelum memulai tugas koding.
 *
 * Fitur:
 * 1. checkAll() — run all checks, return PreflightReport
 * 2. checkTypecheck() — TypeScript compilation check via tsc --noEmit
 * 3. checkLint() — linter compliance (Biome)
 * 4. checkTests() — test pass/fail rate
 * 5. checkGraph() — CodeGraph DB existence + freshness
 * 6. checkDeferredBugs() — read .claude/deferred-bugs.json
 * 7. checkMemory() — cross-agent memory entry count
 * 8. formatReport() — human-readable [PASS/FAIL] checklist string
 *
 * Storage: .claude/preflight-checklist/
 */

import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  /** Human-readable check name (e.g. "TypeScript typecheck") */
  name: string;
  /** Whether the check passed */
  pass: boolean;
  /** Human-readable detail / summary message */
  detail: string;
  /** Optional raw output captured during execution */
  output?: string;
}

export interface PreflightReport {
  /** ISO timestamp when the check run started */
  timestamp: string;
  /** All check results */
  checks: CheckResult[];
  /** True when every check passed */
  allPass: boolean;
  /** Score 0-100 (100 = everything passes) */
  score: number;
  /** Wall-clock duration of the full run in milliseconds */
  duration: number;
}

// ---------------------------------------------------------------------------
// Type-only sub-types returned by individual check functions
// ---------------------------------------------------------------------------

export interface TypecheckResult {
  pass: boolean;
  errors: string[];
  count: number;
}

export interface LintResult {
  pass: boolean;
  warnings: string[];
  count: number;
}

export interface TestResult {
  pass: boolean;
  failing: number;
  passRate: number;
}

export interface GraphResult {
  exists: boolean;
  ageMinutes: number;
  stale: boolean;
}

export interface DeferredBugEntry {
  file: string;
  line?: number;
  severity?: string;
  reason?: string;
  message?: string;
}

export interface DeferredBugsResult {
  count: number;
  items: DeferredBugEntry[];
}

export interface MemoryResult {
  hasEntries: boolean;
  recentCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_DIR = ".claude/preflight-checklist";
const GRAPH_DB_PATH = ".codegraph/graph.json";
const DEFERRED_BUGS_FILE = ".claude/deferred-bugs.json";
const MEMORY_INDEX_FILE = ".claude/cross-agent-memory/memory-index.json";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/** Ensure the storage directory exists. Returns absolute path. */
function ensureStorageDir(root: string): string {
  const dir = join(resolve(root), STORAGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Persist a report as JSONL to the storage directory. */
function persistReport(root: string, report: PreflightReport): void {
  try {
    const dir = ensureStorageDir(root);
    const filePath = join(dir, "reports.jsonl");
    writeFileSync(filePath, JSON.stringify(report) + "\n", { flag: "a", encoding: "utf-8" });
  } catch {
    // non-critical, silently ignore
  }
}

/** Load previous reports from storage (newest first, up to `limit`). */
export function loadReports(root: string, limit = 10): PreflightReport[] {
  const dir = ensureStorageDir(root);
  const filePath = join(dir, "reports.jsonl");
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    const reports: PreflightReport[] = [];
    for (const line of content.split("\n").reverse()) {
      if (!line) continue;
      try {
        reports.push(JSON.parse(line) as PreflightReport);
      } catch {
        // skip corrupt lines
      }
      if (reports.length >= limit) break;
    }
    return reports;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Run a child process, returning { stdout, stderr, exitCode }. */
function run(
  cmd: string,
  args: string[],
  opts?: ExecFileSyncOptions,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execFileSync(cmd, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      ...opts,
    });
    return { stdout: result as string, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.code === "ENOENT" ? -1 : (error.status ?? 1),
    };
  }
}

/** Format elapsed duration as a short string (e.g. "1.2s"). */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check 1: TypeScript typecheck (tsc --noEmit).
 *
 * Reads stdout/stderr lines containing "error TS" to extract error details.
 */
export function checkTypecheck(root: string): TypecheckResult {
  const cwd = resolve(root);
  const { stdout, stderr, exitCode } = run("npx", ["tsc", "--noEmit"], { cwd });

  const allOutput = stdout + "\n" + stderr;
  const errors: string[] = [];

  // Parse error lines: "src/foo.ts:12:3 - error TS2345: ..."
  for (const line of allOutput.split("\n")) {
    const trimmed = line.trim();
    if (/error TS\d+/.test(trimmed)) {
      errors.push(trimmed);
    }
  }

  return {
    pass: exitCode === 0,
    errors,
    count: errors.length,
  };
}

/**
 * Check 2: Linter (Biome) check.
 *
 * Returns all warning/error lines emitted by the linter.
 */
export function checkLint(root: string): LintResult {
  const cwd = resolve(root);
  const { stdout, stderr, exitCode } = run("npx", ["biome", "check", "src"], { cwd });

  const allOutput = stdout + "\n" + stderr;
  const warnings: string[] = [];

  for (const line of allOutput.split("\n")) {
    const trimmed = line.trim();
    // Biome outputs lines like: "src/file.ts:12:3 lint/style/noNonNullAssertion …"
    // Skip header / summary lines
    if (
      trimmed &&
      !trimmed.startsWith("Checked") &&
      !trimmed.startsWith("Finished") &&
      !trimmed.startsWith("biome") &&
      !trimmed.startsWith("note:") &&
      !trimmed.includes("lint rules applied")
    ) {
      const hasDiagnostic = /:\d+:\d+/.test(trimmed);
      if (hasDiagnostic || trimmed.startsWith("error") || trimmed.startsWith("warning")) {
        warnings.push(trimmed);
      }
    }
  }

  return {
    pass: exitCode === 0,
    warnings,
    count: warnings.length,
  };
}

/**
 * Check 3: Test suite.
 *
 * Runs `npm test` (which runs the project's test command).
 * Parses the output for test pass/fail metrics.
 */
export function checkTests(root: string): TestResult {
  const cwd = resolve(root);
  const { stdout, stderr, exitCode } = run("npm", ["run", "test", "--", "--reporter=spec"], {
    cwd,
    timeout: 300_000,
  });

  const allOutput = stdout + "\n" + stderr;

  // Try to parse test result summary
  // Common patterns:
  //   "tests 42" / "passing 40" / "failing 2" (node:test)
  //   "Tests: 42 passed, 2 failed" (jest / vitest)
  //   "  <<< FAILURES! >>>" (node:test)

  let total = 0;
  let passed = 0;
  let failing = 0;

  // Pattern 1: node:test -- "tests 42" / "passing 40" / "failing 2"
  const testsMatch = allOutput.match(/\btests\s+(\d+)/);
  const passingMatch = allOutput.match(/\bpassing\s+(\d+)/);
  const failingMatch = allOutput.match(/\bfailing\s+(\d+)/);

  if (testsMatch) total = Number(testsMatch[1]);
  if (passingMatch) passed = Number(passingMatch[1]);
  if (failingMatch) failing = Number(failingMatch[1]);

  // Pattern 2: "Tests: 42 passed, 2 failed"
  if (!total) {
    const summaryMatch = allOutput.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+failed/);
    if (summaryMatch) {
      passed = Number(summaryMatch[1]);
      failing = Number(summaryMatch[2]);
      total = passed + failing;
    }
  }

  // Fallback: count "ok" / "not ok" lines (TAP output)
  if (!total) {
    const okLines = (allOutput.match(/^ok\s+/gm) ?? []).length;
    const notOkLines = (allOutput.match(/^not\s+ok\s+/gm) ?? []).length;
    if (okLines + notOkLines > 0) {
      passed = okLines;
      failing = notOkLines;
      total = okLines + notOkLines;
    }
  }

  // If we still have no numbers, use exit code heuristic
  if (!total) {
    total = 1;
    passed = exitCode === 0 ? 1 : 0;
    failing = exitCode === 0 ? 0 : 1;
  }

  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return {
    pass: exitCode === 0,
    failing,
    passRate,
  };
}

/**
 * Check 4: CodeGraph database.
 *
 * Checks whether the graph DB file exists and how old it is.
 */
export function checkGraph(root: string): GraphResult {
  const dbPath = join(resolve(root), GRAPH_DB_PATH);

  if (!existsSync(dbPath)) {
    return {
      exists: false,
      ageMinutes: -1,
      stale: true,
    };
  }

  try {
    const mtimeMs = statSync(dbPath).mtimeMs;
    const ageMinutes = Math.round((Date.now() - mtimeMs) / 60_000);
    return {
      exists: true,
      ageMinutes,
      stale: ageMinutes > 120,
    };
  } catch {
    return {
      exists: false,
      ageMinutes: -1,
      stale: true,
    };
  }
}

/**
 * Check 5: Deferred bugs.
 *
 * Reads .claude/deferred-bugs.json and counts entries.
 */
export function checkDeferredBugs(root: string): DeferredBugsResult {
  const bugsPath = join(resolve(root), DEFERRED_BUGS_FILE);

  if (!existsSync(bugsPath)) {
    return { count: 0, items: [] };
  }

  try {
    const raw = readFileSync(bugsPath, "utf-8");
    const data = JSON.parse(raw) as
      | DeferredBugEntry[]
      | { bugs?: DeferredBugEntry[]; items?: DeferredBugEntry[] };
    let items: DeferredBugEntry[];

    if (Array.isArray(data)) {
      items = data;
    } else if (Array.isArray((data as Record<string, unknown>).bugs)) {
      items = (data as { bugs: DeferredBugEntry[] }).bugs;
    } else if (Array.isArray((data as Record<string, unknown>).items)) {
      items = (data as { items: DeferredBugEntry[] }).items;
    } else {
      items = [];
    }

    return { count: items.length, items };
  } catch {
    return { count: 0, items: [] };
  }
}

/**
 * Check 6: Cross-agent memory.
 *
 * Checks whether memory index file exists and counts recent entries.
 */
export function checkMemory(root: string): MemoryResult {
  const memoryPath = join(resolve(root), MEMORY_INDEX_FILE);

  if (!existsSync(memoryPath)) {
    return { hasEntries: false, recentCount: 0 };
  }

  try {
    const raw = readFileSync(memoryPath, "utf-8");
    const data = JSON.parse(raw) as { entries?: unknown[] };
    const entries: Array<{ createdAt?: string }> = (data.entries ?? []) as Array<{
      createdAt?: string;
    }>;
    const hasEntries = entries.length > 0;

    // "Recent" = entries created within the last 7 days
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const recentCount = entries.filter((e) => {
      if (!e.createdAt) return false;
      const age = Date.now() - new Date(e.createdAt).getTime();
      return age < sevenDaysMs;
    }).length;

    return { hasEntries, recentCount };
  } catch {
    return { hasEntries: false, recentCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Aggregated check
// ---------------------------------------------------------------------------

/**
 * Run all six checks and return a PreflightReport.
 *
 * @param root - Project root directory (default: process.cwd())
 * @param skip - Optional array of check names to skip
 */
export function checkAll(root?: string, skip?: string[]): PreflightReport {
  const resolvedRoot = resolve(root ?? process.cwd());
  const skipSet = new Set(skip ?? []);
  const start = Date.now();
  const checks: CheckResult[] = [];
  const timestamp = new Date().toISOString();

  // --- 1. Typecheck ---
  if (!skipSet.has("typecheck")) {
    const tc = checkTypecheck(resolvedRoot);
    checks.push({
      name: "TypeScript typecheck",
      pass: tc.pass,
      detail: tc.pass
        ? `No type errors`
        : `${tc.count} type error${tc.count === 1 ? "" : "s"} found`,
      output: tc.errors.length > 0 ? tc.errors.join("\n") : undefined,
    });
  }

  // --- 2. Lint ---
  if (!skipSet.has("lint")) {
    const lint = checkLint(resolvedRoot);
    checks.push({
      name: "Linter (Biome)",
      pass: lint.pass,
      detail: lint.pass
        ? `No lint warnings`
        : `${lint.count} lint warning${lint.count === 1 ? "" : "s"}`,
      output: lint.warnings.length > 0 ? lint.warnings.join("\n") : undefined,
    });
  }

  // --- 3. Tests ---
  if (!skipSet.has("tests")) {
    const t = checkTests(resolvedRoot);
    checks.push({
      name: "Test suite",
      pass: t.pass,
      detail: t.pass
        ? `All tests passing (${t.passRate}%)`
        : `${t.failing} test${t.failing === 1 ? "" : "s"} failing (${t.passRate}% pass rate)`,
      output: undefined,
    });
  }

  // --- 4. CodeGraph ---
  if (!skipSet.has("graph")) {
    const g = checkGraph(resolvedRoot);
    if (!g.exists) {
      checks.push({
        name: "CodeGraph database",
        pass: false,
        detail: "Graph database not found — run scan_codebase first",
        output: undefined,
      });
    } else if (g.stale) {
      checks.push({
        name: "CodeGraph database",
        pass: false,
        detail: `Graph is ${g.ageMinutes}m old — stale (threshold: 120m)`,
        output: undefined,
      });
    } else {
      checks.push({
        name: "CodeGraph database",
        pass: true,
        detail: `Graph is fresh (${g.ageMinutes}m old)`,
        output: undefined,
      });
    }
  }

  // --- 5. Deferred bugs ---
  if (!skipSet.has("deferredBugs")) {
    const db = checkDeferredBugs(resolvedRoot);
    checks.push({
      name: "Deferred bugs",
      pass: db.count === 0,
      detail:
        db.count === 0
          ? "No deferred bugs"
          : `${db.count} deferred bug${db.count === 1 ? "" : "s"} — check .claude/deferred-bugs.json`,
      output:
        db.count > 0
          ? db.items
              .map(
                (i) =>
                  `${i.file}:${i.line ?? "?"} [${i.severity ?? "?"}] ${i.reason ?? i.message ?? ""}`,
              )
              .join("\n")
          : undefined,
    });
  }

  // --- 6. Memory ---
  if (!skipSet.has("memory")) {
    const m = checkMemory(resolvedRoot);
    checks.push({
      name: "Cross-agent memory",
      pass: true, // memory is informational, not a gate
      detail: m.hasEntries
        ? `${m.recentCount} recent entr${m.recentCount === 1 ? "y" : "ies"} (out of ${m.recentCount + (m.recentCount > 0 ? "+" : "0")} total)`
        : "No memory entries found",
      output: undefined,
    });
  }

  const duration = Date.now() - start;

  // Score: each passing check contributes equally to 100
  const passed = checks.filter((c) => c.pass).length;
  const score = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 100;
  const allPass = checks.every((c) => c.pass);

  const report: PreflightReport = { timestamp, checks, allPass, score, duration };

  // Persist to storage directory
  persistReport(resolvedRoot, report);

  return report;
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Format a PreflightReport as a human-readable checklist string.
 *
 * Each check gets a `[PASS]` or `[FAIL]` badge with detail.
 * Returns a tidy single-block string suitable for terminal or LLM context.
 */
export function formatReport(report: PreflightReport): string {
  const lines: string[] = [];

  // ── Header ──
  lines.push("── Preflight Checklist ──────────────────────────────────");
  lines.push(`  Timestamp : ${report.timestamp}`);
  lines.push(`  Duration  : ${fmtDuration(report.duration)}`);
  lines.push(`  Score     : ${report.score}/100`);
  lines.push(`  Result    : ${report.allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  lines.push("");

  // ── Individual checks ──
  for (const check of report.checks) {
    const badge = check.pass ? "[PASS]" : "[FAIL]";
    lines.push(`  ${badge} ${check.name}`);
    lines.push(`         ${check.detail}`);

    // Show up to 5 output lines indented
    if (check.output) {
      const outLines = check.output.split("\n").slice(0, 5);
      for (const ol of outLines) {
        lines.push(`         > ${ol}`);
      }
      if (check.output.split("\n").length > 5) {
        lines.push(`         > ... (${check.output.split("\n").length - 5} more lines)`);
      }
    }
    lines.push("");
  }

  // ── Footer ──
  lines.push(
    `  ${report.checks.length} check${report.checks.length === 1 ? "" : "s"}, ` +
      `${report.checks.filter((c) => c.pass).length} passed, ` +
      `${report.checks.filter((c) => !c.pass).length} failed`,
  );
  lines.push("──────────────────────────────────────────────────────────");

  return lines.join("\n");
}
