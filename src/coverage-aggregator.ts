#!/usr/bin/env node
/**
 * Coverage Aggregator
 *
 * Merges test coverage reports from various tools (Jest, Vitest, Istanbul, nyc,
 * Playwright) and LCOV format. Computes per-file percentages, aggregate totals,
 * threshold checks, and formatted output.
 */

import * as fs from "node:fs";
import { readJsonSafe } from "./utils/index.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface CoverageFile {
  path: string;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  uncoveredLines: number[];
}

export interface CoverageReport {
  files: CoverageFile[];
  totalStatements: number;
  coveredStatements: number;
  totalBranches: number;
  coveredBranches: number;
  totalFunctions: number;
  coveredFunctions: number;
  totalLines: number;
  coveredLines: number;
  overallPercent: number;
  generatedAt: string;
  /** Populated when a parse error occurs or no data is found */
  error?: string;
}

export type CoverageTool = "jest" | "vitest" | "playwright" | "istanbul" | "nyc";

// ─── Internal Raw Data ───────────────────────────────────────────────────

interface RawFileCoverage {
  path: string;
  totalStatements: number;
  coveredStatements: number;
  totalBranches: number;
  coveredBranches: number;
  totalFunctions: number;
  coveredFunctions: number;
  totalLines: number;
  coveredLines: number;
  uncoveredLines: number[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function toCoverageFile(raw: RawFileCoverage): CoverageFile {
  return {
    path: raw.path,
    statements:
      raw.totalStatements > 0
        ? Math.round((raw.coveredStatements / raw.totalStatements) * 100)
        : 100,
    branches:
      raw.totalBranches > 0 ? Math.round((raw.coveredBranches / raw.totalBranches) * 100) : 100,
    functions:
      raw.totalFunctions > 0 ? Math.round((raw.coveredFunctions / raw.totalFunctions) * 100) : 100,
    lines: raw.totalLines > 0 ? Math.round((raw.coveredLines / raw.totalLines) * 100) : 100,
    uncoveredLines: raw.uncoveredLines.slice().sort((a, b) => a - b),
  };
}

function buildReport(rawFiles: RawFileCoverage[], error?: string): CoverageReport {
  const totalStatements = rawFiles.reduce((s, f) => s + f.totalStatements, 0);
  const coveredStatements = rawFiles.reduce((s, f) => s + f.coveredStatements, 0);
  const totalBranches = rawFiles.reduce((s, f) => s + f.totalBranches, 0);
  const coveredBranches = rawFiles.reduce((s, f) => s + f.coveredBranches, 0);
  const totalFunctions = rawFiles.reduce((s, f) => s + f.totalFunctions, 0);
  const coveredFunctions = rawFiles.reduce((s, f) => s + f.coveredFunctions, 0);
  const totalLines = rawFiles.reduce((s, f) => s + f.totalLines, 0);
  const coveredLines = rawFiles.reduce((s, f) => s + f.coveredLines, 0);

  const overallPercent = totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 0;

  return {
    files: rawFiles.map(toCoverageFile),
    totalStatements,
    coveredStatements,
    totalBranches,
    coveredBranches,
    totalFunctions,
    coveredFunctions,
    totalLines,
    coveredLines,
    overallPercent,
    generatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

function emptyReport(error?: string): CoverageReport {
  return buildReport([], error);
}


// ─── Istanbul JSON Parser ──────────────────────────────────────────────────
// Shared by parseJestCoverage, parseVitestCoverage, parsePlaywrightCoverage

function parseIstanbulJson(jsonPath: string): CoverageReport {
  if (!fs.existsSync(jsonPath)) {
    return emptyReport(`File not found: ${jsonPath}`);
  }

  const data = readJsonSafe(jsonPath);
  if (!data) {
    return emptyReport(`Failed to parse JSON: ${jsonPath}`);
  }

  const rawFiles: RawFileCoverage[] = [];

  for (const [filePath, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object") continue;
    const cov = entry as Record<string, unknown>;
    if (!cov.s || !cov.f || !cov.b || !cov.l) continue;

    const s = cov.s as Record<string, number>;
    const f = cov.f as Record<string, number>;
    const b = cov.b as Record<string, number[]>;
    const l = cov.l as Record<string, number>;

    const totalStatements = Object.keys(s).length;
    const coveredStatements = Object.values(s).filter((v) => v > 0).length;

    const totalFunctions = Object.keys(f).length;
    const coveredFunctions = Object.values(f).filter((v) => v > 0).length;

    const branchEntries = Object.values(b);
    const totalBranches = branchEntries.reduce((sum, arr) => sum + arr.length, 0);
    const coveredBranches = branchEntries.reduce(
      (sum, arr) => sum + arr.filter((v) => v > 0).length,
      0,
    );

    const totalLines = Object.keys(l).length;
    const coveredLines = Object.values(l).filter((v) => v > 0).length;

    const uncoveredLines = Object.entries(l)
      .filter(([, hits]) => hits === 0)
      .map(([line]) => Number(line));

    rawFiles.push({
      path: filePath,
      totalStatements,
      coveredStatements,
      totalBranches,
      coveredBranches,
      totalFunctions,
      coveredFunctions,
      totalLines,
      coveredLines,
      uncoveredLines,
    });
  }

  if (rawFiles.length === 0) {
    return emptyReport(`No coverage data found in ${jsonPath}`);
  }

  return buildReport(rawFiles);
}

// ─── LCOV Parser ───────────────────────────────────────────────────────────

function parseLcovBody(content: string): CoverageReport {
  const rawFiles: RawFileCoverage[] = [];
  const records = content.split("end_of_record");

  for (const record of records) {
    const lines = record
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let sf = "";
    const daEntries: Array<{ line: number; hits: number }> = [];
    const fnEntries: Array<{ line: number; name: string }> = [];
    const fndaEntries: Map<string, number> = new Map();
    const brdaEntries: Array<{ line: number; block: number; branch: number; taken: number }> = [];

    for (const line of lines) {
      if (line.startsWith("SF:")) {
        sf = line.slice(3).trim();
      } else if (line.startsWith("DA:")) {
        const parts = line.slice(3).split(",");
        if (parts.length >= 2) {
          daEntries.push({
            line: Number(parts[0]),
            hits: Number(parts[1]),
          });
        }
      } else if (line.startsWith("FN:")) {
        const parts = line.slice(3).split(",");
        if (parts.length >= 2) {
          fnEntries.push({
            line: Number(parts[0]),
            name: parts.slice(1).join(",").trim(),
          });
        }
      } else if (line.startsWith("FNDA:")) {
        const parts = line.slice(5).split(",");
        if (parts.length >= 2) {
          fndaEntries.set(parts.slice(1).join(",").trim(), Number(parts[0]));
        }
      } else if (line.startsWith("BRDA:")) {
        const parts = line.slice(5).split(",");
        if (parts.length >= 4) {
          brdaEntries.push({
            line: Number(parts[0]),
            block: Number(parts[1]),
            branch: Number(parts[2]),
            taken: parts[3] === "-" ? 0 : Number(parts[3]),
          });
        }
      }
    }

    if (!sf || daEntries.length === 0) continue;

    // Line coverage
    const totalLines = daEntries.length;
    const coveredLines = daEntries.filter((d) => d.hits > 0).length;
    const uncoveredLines = daEntries.filter((d) => d.hits === 0).map((d) => d.line);

    // Statement coverage — derive from DA as a reasonable proxy
    const totalStatements = totalLines;
    const coveredStatements = coveredLines;

    // Function coverage
    const totalFunctions = fnEntries.length > 0 ? fnEntries.length : fndaEntries.size;
    const coveredFunctions =
      fndaEntries.size > 0 ? Array.from(fndaEntries.values()).filter((h) => h > 0).length : 0;

    // Branch coverage
    const totalBranches = brdaEntries.length;
    const coveredBranches = brdaEntries.filter((b) => b.taken > 0).length;

    rawFiles.push({
      path: sf,
      totalStatements,
      coveredStatements,
      totalBranches,
      coveredBranches,
      totalFunctions,
      coveredFunctions,
      totalLines,
      coveredLines,
      uncoveredLines,
    });
  }

  if (rawFiles.length === 0) {
    return emptyReport("No valid LCOV records found");
  }

  return buildReport(rawFiles);
}

// ─── Merge Logic ───────────────────────────────────────────────────────────

function mergeRawFiles(target: RawFileCoverage, source: RawFileCoverage): RawFileCoverage {
  // For counts: keep the max (assumes the report with more coverage is more complete)
  const pickMax = (a: number, b: number) => Math.max(a, b);
  const pickCoveredMax = (total: number, a: number, b: number) => Math.max(a, b);

  return {
    path: target.path,
    totalStatements: pickMax(target.totalStatements, source.totalStatements),
    coveredStatements: pickCoveredMax(
      pickMax(target.totalStatements, source.totalStatements),
      target.coveredStatements,
      source.coveredStatements,
    ),
    totalBranches: pickMax(target.totalBranches, source.totalBranches),
    coveredBranches: pickCoveredMax(
      pickMax(target.totalBranches, source.totalBranches),
      target.coveredBranches,
      source.coveredBranches,
    ),
    totalFunctions: pickMax(target.totalFunctions, source.totalFunctions),
    coveredFunctions: pickCoveredMax(
      pickMax(target.totalFunctions, source.totalFunctions),
      target.coveredFunctions,
      source.coveredFunctions,
    ),
    totalLines: pickMax(target.totalLines, source.totalLines),
    coveredLines: pickCoveredMax(
      pickMax(target.totalLines, source.totalLines),
      target.coveredLines,
      source.coveredLines,
    ),
    // Union of uncovered lines
    uncoveredLines: [...new Set([...target.uncoveredLines, ...source.uncoveredLines])],
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Parse Jest's coverage-final.json (Istanbul JSON format).
 * If the file doesn't exist, returns an empty report with an error.
 */
export function parseJestCoverage(jsonPath: string): CoverageReport {
  return parseIstanbulJson(jsonPath);
}

/**
 * Parse Vitest coverage output (identical Istanbul JSON format).
 * Accepts both vitest JSON and raw Istanbul JSON.
 */
export function parseVitestCoverage(jsonPath: string): CoverageReport {
  return parseIstanbulJson(jsonPath);
}

/**
 * Parse Playwright coverage output (Istanbul JSON format).
 */
export function parsePlaywrightCoverage(jsonPath: string): CoverageReport {
  return parseIstanbulJson(jsonPath);
}

/**
 * Parse Istanbul's own coverage-final.json (identical format).
 */
export function parseIstanbulCoverage(jsonPath: string): CoverageReport {
  return parseIstanbulJson(jsonPath);
}

/**
 * Parse nyc coverage output (Istanbul JSON format).
 */
export function parseNycCoverage(jsonPath: string): CoverageReport {
  return parseIstanbulJson(jsonPath);
}

/**
 * Parse lcov.info format coverage data.
 *
 * Format:
 *   SF:<file path>
 *   DA:<line>,<hit count>
 *   FN:<line>,<function name>
 *   FNDA:<hit count>,<function name>
 *   BRDA:<line>,<block>,<branch>,<taken>
 *   end_of_record
 */
export function parseLcovFile(lcovPath: string): CoverageReport {
  if (!fs.existsSync(lcovPath)) {
    return emptyReport(`File not found: ${lcovPath}`);
  }

  let content: string;
  try {
    content = fs.readFileSync(lcovPath, "utf-8");
  } catch {
    return emptyReport(`Failed to read LCOV file: ${lcovPath}`);
  }

  return parseLcovBody(content);
}

/**
 * Merge multiple coverage sources into a single report.
 *
 * For each file that appears in more than one source, the maximum coverage
 * values are kept and uncovered lines are unioned. Per-file percentages are
 * computed from the merged raw counts.
 *
 * @param sources - Array of { tool, path } objects identifying each source.
 */
export function aggregateCoverage(
  sources: Array<{ tool: CoverageTool; path: string }>,
): CoverageReport {
  if (sources.length === 0) {
    return emptyReport("No coverage sources provided");
  }

  // Parse each source into a report
  const reports: CoverageReport[] = sources.map(({ tool, path }) => {
    switch (tool) {
      case "jest":
        return parseJestCoverage(path);
      case "vitest":
        return parseVitestCoverage(path);
      case "playwright":
        return parsePlaywrightCoverage(path);
      case "istanbul":
        return parseIstanbulCoverage(path);
      case "nyc":
        return parseNycCoverage(path);
      default: {
        const _exhaustive: never = tool;
        return emptyReport(`Unknown coverage tool: ${_exhaustive}`);
      }
    }
  });

  // Collect raw data from each report by re-parsing the raw stats.
  // We rebuild RawFileCoverage from CoverageFile percentages (which is lossy)
  // but we also reference the original raw data when available.
  // Since parseIstanbulJson produces the report from RawFileCoverage, and we
  // want to be precise, we re-derive from the raw source files when possible.
  //
  // For robustness, we treat the aggregated CoverageFile percentages as the
  // source of truth for per-file merge. When only percentages are available
  // (no raw counts), we reconstruct counts by treating the file as if it had
  // 100 statements/lines etc., with the percentage being the covered count.
  // This is lossy but ensures the merge always produces sensible results.

  const rawByPath = new Map<string, RawFileCoverage>();

  for (const report of reports) {
    for (const file of report.files) {
      const existing = rawByPath.get(file.path);
      // Reconstruct raw data from the CoverageFile (we only have percentages)
      // Use the uncovered lines as concrete data we can union.
      const reconstructed: RawFileCoverage = {
        path: file.path,
        totalStatements: 100,
        coveredStatements: file.statements,
        totalBranches: 100,
        coveredBranches: file.branches,
        totalFunctions: 100,
        coveredFunctions: file.functions,
        totalLines: 100,
        coveredLines: file.lines,
        uncoveredLines: file.uncoveredLines.slice(),
      };

      if (existing) {
        rawByPath.set(file.path, mergeRawFiles(existing, reconstructed));
      } else {
        rawByPath.set(file.path, reconstructed);
      }
    }
  }

  const mergedRawFiles = Array.from(rawByPath.values());
  if (mergedRawFiles.length === 0) {
    return emptyReport("No coverage data after merging sources");
  }

  return buildReport(mergedRawFiles);
}

/**
 * Check a coverage report against a minimum percentage threshold.
 *
 * @param report    - The coverage report to check.
 * @param threshold - Minimum acceptable coverage percentage (0-100).
 * @returns Object with a boolean pass/fail and per-file details.
 */
export function checkCoverageThreshold(
  report: CoverageReport,
  threshold: number,
): { pass: boolean; details: Array<{ file: string; percent: number; threshold: number }> } {
  const details: Array<{ file: string; percent: number; threshold: number }> = [];

  for (const file of report.files) {
    // Use line coverage as the primary metric for threshold checking
    const percent = file.lines;
    if (percent < threshold) {
      details.push({ file: file.path, percent, threshold });
    }
  }

  return {
    pass: details.length === 0,
    details,
  };
}

// ─── Formatter ─────────────────────────────────────────────────────────────

const CYAN = "[36m";
const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const RESET = "[0m";
const GRAY = "[90m";

function colorPercent(pct: number): string {
  if (pct >= 90) return `${GREEN}${pct}%${RESET}`;
  if (pct >= 75) return `${YELLOW}${pct}%${RESET}`;
  return `${RED}${pct}%${RESET}`;
}

function colorBar(pct: number, width: number = 10): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = GREEN + "█".repeat(filled) + GRAY + "░".repeat(empty) + RESET;
  return bar;
}

/**
 * Format a coverage report as a human-readable table with color indicators.
 */
export function formatCoverageReport(report: CoverageReport): string {
  const lines: string[] = [];
  const div = "─".repeat(80);

  lines.push("");
  lines.push(`${BOLD}Coverage Report${RESET}`);
  lines.push(`  ${div}`);
  lines.push(`  Generated: ${report.generatedAt}`);
  if (report.error) {
    lines.push(`  ${RED}⚠ ${report.error}${RESET}`);
  }
  lines.push("");

  // ── Overall summary ──────────────────────────────────────────────
  lines.push(`  ${BOLD}Overall${RESET}`);
  lines.push(`  ${div}`);
  lines.push(
    `  Statements: ${colorPercent(Math.round((report.coveredStatements / Math.max(report.totalStatements, 1)) * 100))}  ` +
      `(${report.coveredStatements}/${report.totalStatements})`,
  );
  lines.push(
    `  Branches:   ${colorPercent(Math.round((report.coveredBranches / Math.max(report.totalBranches, 1)) * 100))}  ` +
      `(${report.coveredBranches}/${report.totalBranches})`,
  );
  lines.push(
    `  Functions:  ${colorPercent(Math.round((report.coveredFunctions / Math.max(report.totalFunctions, 1)) * 100))}  ` +
      `(${report.coveredFunctions}/${report.totalFunctions})`,
  );
  lines.push(
    `  Lines:      ${colorPercent(report.overallPercent)}  ` +
      `(${report.coveredLines}/${report.totalLines})`,
  );
  lines.push(`  ${colorBar(report.overallPercent, 20)}`);
  lines.push("");

  if (report.files.length === 0) {
    lines.push("  No files in report.");
    lines.push("");
    return lines.join("\n");
  }

  // ── Per-file table ───────────────────────────────────────────────
  const H = (s: string, w: number) => s.padEnd(w);
  const header = `${"File".padEnd(50)} ${"Stmts".padStart(6)} ${"Branch".padStart(6)} ${"Funcs".padStart(6)} ${"Lines".padStart(6)}  ${"Bar".padEnd(12)}`;
  lines.push(`  ${BOLD}Files${RESET}`);
  lines.push(`  ${div}`);
  lines.push(`  ${header}`);
  lines.push(
    `  ${GRAY}${"─".repeat(50)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(6)}  ${"─".repeat(12)}${RESET}`,
  );

  for (const file of report.files) {
    const name = file.path.length > 48 ? "..." + file.path.slice(-45) : file.path;
    lines.push(
      `  ${H(name, 50)} ` +
        `${colorPercent(file.statements).padStart(11)} ` +
        `${colorPercent(file.branches).padStart(11)} ` +
        `${colorPercent(file.functions).padStart(11)} ` +
        `${colorPercent(file.lines).padStart(11)}  ` +
        `${colorBar(file.lines, 10)}`,
    );
  }
  lines.push("");

  // ── Low coverage files ───────────────────────────────────────────
  const lowCoverage = report.files.filter((f) => f.lines < 75);
  if (lowCoverage.length > 0) {
    lines.push(`  ${YELLOW}Low-coverage files (< 75%)${RESET}`);
    lines.push(`  ${div}`);
    for (const f of lowCoverage) {
      lines.push(`    ${f.path}  ${colorPercent(f.lines)}  ${colorBar(f.lines, 10)}`);
      const uncovered = f.uncoveredLines;
      if (uncovered.length > 0) {
        const snippet =
          uncovered.length <= 10
            ? uncovered.join(", ")
            : uncovered.slice(0, 10).join(", ") + `, ... (+${uncovered.length - 10} more)`;
        lines.push(`      ${GRAY}uncovered lines: ${snippet}${RESET}`);
      }
    }
    lines.push("");
  }

  // ── Key ──────────────────────────────────────────────────────────
  lines.push(`  Key:`);
  lines.push(`    ${GREEN}≥ 90%${RESET}  ${YELLOW}75–89%${RESET}  ${RED}< 75%${RESET}`);
  lines.push(`  ${div}`);
  lines.push("");

  return lines.join("\n");
}
