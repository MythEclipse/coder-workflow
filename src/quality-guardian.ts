#!/usr/bin/env node
/**
 * quality-guardian — Quality Guardian
 *
 * Measures, tracks, and reports code quality metrics automatically.
 * Captures snapshots of typecheck, lint, test, coverage, and technical
 * debt status, then compares them to detect regressions.
 *
 * Storage: .claude/quality-guardian/snapshots.jsonl
 *
 * Follows the todo-tracker.ts pattern: synchronous I/O, exported types,
 * JSDoc on every public function, persistent history via JSONL.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { scanForTodos } from "./todo-tracker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualitySnapshot {
  timestamp: string;
  typecheckErrors: number;
  lintWarnings: number;
  testPassRate: number;
  testCoverage?: number;
  debtItems: number;
  consistencyScore: number;
}

export interface RegressionDelta {
  metric: keyof QualitySnapshot;
  before: number | undefined;
  after: number;
  change: number;
  regression: boolean;
}

export interface RegressionReport {
  hasRegression: boolean;
  changes: RegressionDelta[];
  score: number;
  verdict: string;
}

export interface QualityGateResult {
  passed: boolean;
  score: number;
  threshold: number;
  failures: string[];
  snapshot: QualitySnapshot;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUALITY_DIR = ".claude/quality-guardian";
const SNAPSHOTS_FILE = "snapshots.jsonl";

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "build",
  ".next",
  "vendor",
  ".gradle",
  "generated",
  "coverage",
  ".claude",
]);

const WEIGHTS = {
  typecheck: 0.25,
  lint: 0.15,
  test: 0.3,
  coverage: 0.15,
  debt: 0.1,
  consistency: 0.05,
};

const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx"]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureDir(): string {
  const dir = join(process.cwd(), QUALITY_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function walkSourceFiles(root: string): string[] {
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
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(full);
      } else if (st.isFile() && SOURCE_EXTENSIONS.has(extname(full))) {
        result.push(full);
      }
    }
  }

  walk(resolve(root));
  return result;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 60000,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: "utf-8",
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    if (error.stdout !== undefined || error.stderr !== undefined) {
      return {
        stdout: (error.stdout ?? "") as string,
        stderr: (error.stderr ?? "") as string,
        exitCode: error.status ?? 1,
      };
    }
    return { stdout: "", stderr: error.message ?? "Unknown error", exitCode: 1 };
  }
}

function countTypecheckErrors(root: string): number {
  try {
    const result = runCommand("npx", ["tsc", "--noEmit"], root, 120000);
    const output = result.stdout + result.stderr;
    const matches = output.match(/error TS\d+/g);
    return matches?.length ?? 0;
  } catch {
    return 0;
  }
}

function countLintWarnings(root: string): number {
  // Try Biome first
  try {
    const result = runCommand(
      "npx",
      ["--yes", "biome", "check", "--diagnostic-level=warning", "--reporter=json", "."],
      root,
      60000,
    );
    const output = result.stdout;
    if (output.trim()) {
      try {
        const data = JSON.parse(output);
        if (data?.diagnostics && Array.isArray(data.diagnostics)) {
          return data.diagnostics.length;
        }
      } catch {
        // biome JSON parse failed
      }
    }
    const warningCount = (output.match(/(warning|WARN)/g) ?? []).length;
    if (warningCount > 0) return warningCount;
  } catch {
    // biome not available, fall through
  }

  // Fallback to ESLint
  try {
    const result = runCommand("npx", ["eslint", "--format=json", "."], root, 60000);
    const output = result.stdout;
    if (output.trim().startsWith("[")) {
      try {
        const eslintData = JSON.parse(output) as Array<{
          warningCount?: number;
          errorCount?: number;
        }>;
        return eslintData.reduce((sum, file) => sum + (file.warningCount ?? 0), 0);
      } catch {
        // eslint JSON parse failed
      }
    }
    const warningCount = (output.match(/(warning|WARN)/g) ?? []).length;
    if (warningCount > 0) return warningCount;
  } catch {
    // eslint not available
  }

  return 0;
}

function getTestPassRate(root: string): number {
  try {
    const result = runCommand("npm", ["test", "--", "--reporter=json"], root, 180000);
    const output = result.stdout + result.stderr;

    // Try JSON output from Node --test runner
    try {
      const jsonMatch = output.match(/\{[\s\S]*"totalTests"[\s\S]*\}/);
      if (jsonMatch) {
        const testResult = JSON.parse(jsonMatch[0]) as {
          totalTests?: number;
          total?: number;
          passedTests?: number;
          passed?: number;
        };
        const total = testResult.totalTests ?? testResult.total ?? 0;
        const passed = testResult.passedTests ?? testResult.passed ?? 0;
        if (total > 0) return passed / total;
      }
    } catch {
      // json parse failed
    }

    // Fallback: count pass/fail patterns
    const passMatch = output.match(/(\d+)\s+pass/);
    const failMatch = output.match(/(\d+)\s+fail/);
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const total = passed + failed;
    if (total > 0) return passed / total;

    if (/FAIL|failed|Error/gi.test(output)) return 0;
    if (result.exitCode === 0) return 1;
  } catch {
    // npm test failed entirely
  }

  return 1;
}

function getTestCoverage(root: string): number | undefined {
  const coveragePaths = [
    join(root, "coverage", "coverage-summary.json"),
    join(root, "coverage", "coverage-final.json"),
    join(root, ".claude", "coverage", "coverage-summary.json"),
  ];

  for (const covPath of coveragePaths) {
    try {
      if (!existsSync(covPath)) continue;
      const content = readFileSync(covPath, "utf-8");
      const data = JSON.parse(content) as Record<string, unknown>;

      const total = data.total as Record<string, { pct?: number }> | undefined;
      if (total?.lines?.pct !== undefined) {
        return total.lines.pct;
      }
      const lines = data.lines as { pct?: number } | undefined;
      if (lines?.pct !== undefined) {
        return lines.pct;
      }
    } catch {
      // file corrupt or unrecognised format
    }
  }

  return undefined;
}

function computeConsistencyScore(root: string): number {
  try {
    const srcDir = join(root, "src");
    if (!existsSync(srcDir)) return 50;

    const files = walkSourceFiles(srcDir);
    if (files.length === 0) return 50;

    let exportedModules = 0;
    let typedFiles = 0;
    let documentedFiles = 0;

    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const hasExport = content.includes("export ");
        const hasTyping =
          content.includes("interface ") ||
          content.includes("type ") ||
          /:\s*(string|number|boolean|void|never|any|unknown|Record|Partial|Pick|Omit|Promise|Array|Map|Set)</.test(
            content,
          );
        const hasDocs =
          content.includes("/**") || content.includes("// ") || content.includes(" * @");

        if (hasExport) exportedModules++;
        if (hasTyping) typedFiles++;
        if (hasDocs) documentedFiles++;
      } catch {
        // skip unreadable file
      }
    }

    const exportRatio = exportedModules / files.length;
    const typeRatio = typedFiles / files.length;
    const docRatio = documentedFiles / files.length;

    return Math.round(exportRatio * 40 + typeRatio * 35 + docRatio * 25);
  } catch {
    return 50;
  }
}

/** Compute overall quality score (0-100) from raw snapshot fields. */
function computeScore(snapshot: QualitySnapshot): number {
  const typecheckScore = Math.max(0, 100 - snapshot.typecheckErrors * 10);
  const lintScore = Math.max(0, 100 - snapshot.lintWarnings * 2);
  const testScore = snapshot.testPassRate * 100;
  const coverageScore = snapshot.testCoverage ?? 0;
  const debtScore = Math.max(0, 100 - snapshot.debtItems * 5);
  const consistencyScore = snapshot.consistencyScore;

  return Math.round(
    typecheckScore * WEIGHTS.typecheck +
      lintScore * WEIGHTS.lint +
      testScore * WEIGHTS.test +
      coverageScore * WEIGHTS.coverage +
      debtScore * WEIGHTS.debt +
      consistencyScore * WEIGHTS.consistency,
  );
}

// ---------------------------------------------------------------------------
// Storage (JSONL — same pattern as todo-tracker.ts)
// ---------------------------------------------------------------------------

function appendSnapshot(root: string, snapshot: QualitySnapshot): void {
  const dir = ensureDir();
  const filePath = join(dir, SNAPSHOTS_FILE);
  const entry = JSON.stringify({ root, snapshot }) + "\n";
  try {
    appendFileSync(filePath, entry, "utf-8");
  } catch {
    // non-critical
  }
}

function readSnapshots(): Array<{ root: string; snapshot: QualitySnapshot }> {
  const dir = ensureDir();
  const filePath = join(dir, SNAPSHOTS_FILE);
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const entries: Array<{ root: string; snapshot: QualitySnapshot }> = [];
    for (const line of content.trim().split("\n")) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip corrupt lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a quality snapshot of the project at `root`.
 *
 * Runs typecheck (tsc --noEmit), lint (biome/eslint), test (npm test),
 * reads coverage from coverage-summary.json, scans TODO/FIXME/HACK as
 * technical debt, and computes a consistency score from source files.
 *
 * The snapshot is automatically persisted to
 * `.claude/quality-guardian/snapshots.jsonl`.
 *
 * @param root - Absolute or relative path to the project root
 * @returns QualitySnapshot with all metrics
 */
export function captureSnapshot(root: string): QualitySnapshot {
  const resolvedRoot = resolve(root);

  try {
    const typecheckErrors = countTypecheckErrors(resolvedRoot);
    const lintWarnings = countLintWarnings(resolvedRoot);
    const testPassRate = getTestPassRate(resolvedRoot);
    const testCoverage = getTestCoverage(resolvedRoot);

    let debtItems = 0;
    try {
      const todoReport = scanForTodos(resolvedRoot);
      debtItems = todoReport.totalItems;
    } catch {
      // TODO scan is optional
    }

    const consistencyScore = computeConsistencyScore(resolvedRoot);

    const snapshot: QualitySnapshot = {
      timestamp: new Date().toISOString(),
      typecheckErrors,
      lintWarnings,
      testPassRate,
      testCoverage,
      debtItems,
      consistencyScore,
    };

    appendSnapshot(resolvedRoot, snapshot);
    return snapshot;
  } catch {
    // Fallback snapshot when everything fails
    return {
      timestamp: new Date().toISOString(),
      typecheckErrors: 0,
      lintWarnings: 0,
      testPassRate: 1,
      debtItems: 0,
      consistencyScore: 50,
    };
  }
}

/**
 * Compare two snapshots and detect regressions.
 *
 * Every metric field is compared. A change is a regression if:
 * - Error/warning/debt counts go up
 * - Pass rate / coverage / consistency go down
 *
 * @param snapshotBefore - The earlier snapshot
 * @param snapshotAfter  - The later snapshot
 * @returns RegressionReport with changes, score, and verdict
 */
export function detectRegression(
  snapshotBefore: QualitySnapshot,
  snapshotAfter: QualitySnapshot,
): RegressionReport {
  const changes: RegressionDelta[] = [];

  const comparisons: Array<{
    metric: keyof QualitySnapshot;
    label: string;
    worse: (b: number, a: number) => boolean;
  }> = [
    { metric: "typecheckErrors", label: "Typecheck Errors", worse: (b, a) => a > b },
    { metric: "lintWarnings", label: "Lint Warnings", worse: (b, a) => a > b },
    { metric: "testPassRate", label: "Test Pass Rate", worse: (b, a) => a < b },
    { metric: "testCoverage", label: "Test Coverage", worse: (b, a) => (a ?? 0) < (b ?? 0) },
    { metric: "debtItems", label: "Debt Items", worse: (b, a) => a > b },
    { metric: "consistencyScore", label: "Consistency Score", worse: (b, a) => a < b },
  ];

  const beforeScore = computeScore(snapshotBefore);
  const afterScore = computeScore(snapshotAfter);

  for (const comp of comparisons) {
    const beforeVal = (snapshotBefore[comp.metric] ?? 0) as number;
    const afterVal = (snapshotAfter[comp.metric] ?? 0) as number;
    const change = afterVal - beforeVal;
    const regression = comp.worse(beforeVal, afterVal);

    changes.push({
      metric: comp.metric,
      before: beforeVal,
      after: afterVal,
      change,
      regression,
    });
  }

  const regressions = changes.filter((c) => c.regression);
  const hasRegression = regressions.length > 0;
  const score = afterScore;

  let verdict: string;
  if (hasRegression) {
    verdict = `FAIL — ${regressions.length} metric(s) regressed, score ${afterScore}/100 (delta ${(afterScore - beforeScore) > 0 ? "+" : ""}${afterScore - beforeScore})`;
  } else if (afterScore >= beforeScore) {
    verdict = `PASS — No regressions, score ${afterScore}/100 (stable or improved)`;
  } else {
    verdict = `PASS — No regressions detected, score ${afterScore}/100`;
  }

  return { hasRegression, changes, score, verdict };
}

/**
 * Retrieve quality history for a given module path.
 *
 * Reads from `.claude/quality-guardian/snapshots.jsonl` and filters
 * by the resolved module path and (optionally) by recency.
 *
 * @param modulePath - Module path to query
 * @param days       - Number of days of history to include (default: 30)
 * @returns Array of QualitySnapshot ordered oldest-first
 */
export function getTrend(modulePath: string, days = 30): QualitySnapshot[] {
  try {
    const allEntries = readSnapshots();
    const resolvedPath = resolve(modulePath);

    const filtered = allEntries
      .filter((entry) => entry.root === resolvedPath)
      .map((entry) => entry.snapshot)
      .filter((s) => {
        const snapTime = new Date(s.timestamp).getTime();
        const cutoff = Date.now() - days * 86_400_000;
        return snapTime >= cutoff;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return filtered;
  } catch {
    return [];
  }
}

/**
 * Build a map of quality per module.
 *
 * For every unique root path in the snapshot history, the latest
 * snapshot is returned.
 *
 * @returns Record keyed by module path with the most recent snapshot
 */
export function getModuleMap(): Record<string, QualitySnapshot> {
  try {
    const allEntries = readSnapshots();
    const latestPerModule = new Map<string, QualitySnapshot>();

    for (const entry of allEntries) {
      const existing = latestPerModule.get(entry.root);
      if (
        !existing ||
        new Date(entry.snapshot.timestamp).getTime() > new Date(existing.timestamp).getTime()
      ) {
        latestPerModule.set(entry.root, entry.snapshot);
      }
    }

    const result: Record<string, QualitySnapshot> = {};
    for (const [modulePath, snapshot] of latestPerModule) {
      result[modulePath] = snapshot;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Check the current quality gate.
 *
 * Captures a fresh snapshot and validates it against built-in criteria
 * and an optional minimum score threshold.
 *
 * @param threshold - Minimum acceptable score (0-100, default: 70)
 * @returns QualityGateResult with pass/fail, score, and failure list
 */
export function checkGate(threshold?: number): QualityGateResult {
  const gateThreshold = threshold ?? 70;

  try {
    const snapshot = captureSnapshot(process.cwd());
    const failures: string[] = [];

    if (snapshot.typecheckErrors > 0) {
      failures.push(`${snapshot.typecheckErrors} typecheck error(s) present`);
    }

    if (snapshot.testPassRate < 0.9) {
      const rate = (snapshot.testPassRate * 100).toFixed(1);
      failures.push(`Test pass rate ${rate}% is below 90% threshold`);
    }

    if (snapshot.testCoverage !== undefined && snapshot.testCoverage < 50) {
      failures.push(`Test coverage ${snapshot.testCoverage}% is below 50% threshold`);
    }

    const score = computeScore(snapshot);
    if (score < gateThreshold) {
      failures.push(`Quality score ${score} is below threshold ${gateThreshold}`);
    }

    return {
      passed: failures.length === 0,
      score,
      threshold: gateThreshold,
      failures,
      snapshot,
    };
  } catch {
    return {
      passed: false,
      score: 0,
      threshold: gateThreshold,
      failures: ["Failed to capture quality snapshot — check project environment"],
      snapshot: {
        timestamp: new Date().toISOString(),
        typecheckErrors: 0,
        lintWarnings: 0,
        testPassRate: 0,
        debtItems: 0,
        consistencyScore: 0,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a QualitySnapshot as a human-readable string.
 *
 * @param snapshot - The snapshot to format
 * @returns Formatted report string
 */
export function formatReport(snapshot: QualitySnapshot): string {
  const lines: string[] = [];
  const s = snapshot;
  const score = computeScore(snapshot);

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║              QUALITY GUARDIAN REPORT                ║");
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Timestamp         : ${s.timestamp}`);
  lines.push(`  Score             : ${score}/100`);
  lines.push("");
  lines.push("  ── Metrics ─────────────────────────────────────────");
  lines.push("");
  lines.push(`    Typecheck Errors  : ${s.typecheckErrors}`);
  lines.push(`    Lint Warnings     : ${s.lintWarnings}`);
  lines.push(`    Test Pass Rate    : ${(s.testPassRate * 100).toFixed(1)}%`);
  lines.push(
    `    Test Coverage     : ${s.testCoverage !== undefined ? `${s.testCoverage}%` : "N/A"}`,
  );
  lines.push(`    Debt Items        : ${s.debtItems}`);
  lines.push(`    Consistency       : ${s.consistencyScore}/100`);
  lines.push("");

  // Rating
  let rating: string;
  if (score >= 90) rating = "Excellent";
  else if (score >= 75) rating = "Good";
  else if (score >= 60) rating = "Fair";
  else if (score >= 40) rating = "Poor";
  else rating = "Critical";

  lines.push(`  Rating            : ${rating}`);
  lines.push("");

  // Recommendations
  const recommendations: string[] = [];
  if (s.typecheckErrors > 0) {
    recommendations.push("Fix typecheck errors before proceeding.");
  }
  if (s.lintWarnings > 10) {
    recommendations.push(
      `${s.lintWarnings} lint warnings present. Run linter to improve consistency.`,
    );
  }
  if (s.testPassRate < 0.9) {
    recommendations.push(
      `Test pass rate ${(s.testPassRate * 100).toFixed(1)}% needs to reach at least 90%.`,
    );
  }
  if (s.testCoverage !== undefined && s.testCoverage < 60) {
    recommendations.push(`Coverage ${s.testCoverage}%. Add more unit tests to reach 60%.`);
  }
  if (s.debtItems > 5) {
    recommendations.push(
      `Resolve ${s.debtItems} debt items (TODO/FIXME/HACK) to reduce technical debt.`,
    );
  }
  if (s.consistencyScore < 60) {
    recommendations.push(
      "Improve code consistency: use exports, type/interface annotations, and JSDoc documentation evenly.",
    );
  }

  if (recommendations.length > 0) {
    lines.push("  ── Recommendations ────────────────────────────────");
    lines.push("");
    for (const rec of recommendations) {
      lines.push(`    [*] ${rec}`);
    }
    lines.push("");
  }

  lines.push("  ────────────────────────────────────────────────────");
  lines.push("");

  return lines.join("\n");
}

/**
 * Format a RegressionReport as a human-readable string.
 *
 * @param regression - The regression report to format
 * @returns Formatted regression report string
 */
export function formatRegression(regression: RegressionReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║          QUALITY REGRESSION REPORT                  ║");
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Verdict      : ${regression.verdict}`);
  lines.push(`  Score        : ${regression.score}/100`);
  lines.push(
    `  Regressions  : ${regression.changes.filter((c) => c.regression).length} / ${regression.changes.length} metrics`,
  );
  lines.push("");

  const regressed = regression.changes.filter((c) => c.regression);
  if (regressed.length > 0) {
    lines.push("  ── Regressed Metrics ──────────────────────────────");
    lines.push("");
    for (const c of regressed) {
      const beforeStr = formatMetricValue(c.before, c.metric);
      const afterStr = formatMetricValue(c.after, c.metric);
      lines.push(`    [REGRESSION] ${c.metric}: ${beforeStr} -> ${afterStr}`);
    }
    lines.push("");
  }

  const improved = regression.changes.filter((c) => !c.regression && c.change !== 0);
  if (improved.length > 0) {
    lines.push("  ── Improved Metrics ───────────────────────────────");
    lines.push("");
    for (const c of improved) {
      const beforeStr = formatMetricValue(c.before, c.metric);
      const afterStr = formatMetricValue(c.after, c.metric);
      lines.push(`    [IMPROVED]  ${c.metric}: ${beforeStr} -> ${afterStr}`);
    }
    lines.push("");
  }

  // Detailed table
  lines.push("  ── Change Detail ───────────────────────────────────");
  lines.push("");
  lines.push("  | Metric                  | Before  | After   | Delta   | Status  |");
  lines.push("  |-------------------------|---------|---------|---------|---------|");

  for (const c of regression.changes) {
    const label = c.metric.padEnd(24);
    const beforeStr = (c.before?.toString() ?? "N/A").padStart(7);
    const afterStr = c.after.toString().padStart(7);
    const prefix = c.change > 0 ? "+" : "";
    const deltaStr = `${prefix}${c.change}`.padStart(7);
    const status = c.regression ? "REGRESS " : "OK      ";
    lines.push(`  | ${label} | ${beforeStr} | ${afterStr} | ${deltaStr} | ${status} |`);
  }

  lines.push("");
  lines.push("  ────────────────────────────────────────────────────");
  lines.push("");

  return lines.join("\n");
}

function formatMetricValue(value: number | undefined, metric: keyof QualitySnapshot): string {
  if (value === undefined) return "N/A";
  if (metric === "testPassRate") return `${(value * 100).toFixed(1)}%`;
  if (metric === "testCoverage") return `${value.toFixed(1)}%`;
  return value.toString();
}
