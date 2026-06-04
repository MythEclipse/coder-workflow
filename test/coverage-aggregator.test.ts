import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  aggregateCoverage,
  checkCoverageThreshold,
  formatCoverageReport,
} from "../src/coverage-aggregator.js";
import type { CoverageReport } from "../src/coverage-aggregator.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coverage-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(root, filePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// aggregateCoverage
// ---------------------------------------------------------------------------

test("aggregateCoverage - returns error report for empty sources", () => {
  const report = aggregateCoverage([]);
  assert.ok(report.error);
  assert.ok(report.error!.includes("No coverage sources"));
});

test("aggregateCoverage - parses Istanbul JSON coverage file", () => {
  const root = fixture({
    "coverage-final.json": JSON.stringify({
      "src/app.ts": {
        s: { "0": 1, "1": 0, "2": 1 },
        f: { "0": 1 },
        b: { "0": [1, 0] },
        l: { "1": 1, "2": 0, "3": 1 },
      },
    }),
  });

  const report = aggregateCoverage([
    { tool: "jest", path: join(root, "coverage-final.json") },
  ]);

  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].path, "src/app.ts");
  // 2 of 3 statements covered = 67%
  assert.equal(report.files[0].statements, 67);
  // 1 of 2 branches covered = 50%
  assert.equal(report.files[0].branches, 50);
  // 1 of 1 function covered = 100%
  assert.equal(report.files[0].functions, 100);
  // 2 of 3 lines covered = 67%
  assert.equal(report.files[0].lines, 67);
});

test("aggregateCoverage - handles all tools using same Istanbul format", () => {
  const root = fixture({
    "coverage.json": JSON.stringify({
      "src/app.ts": {
        s: { "0": 1 },
        f: { "0": 1 },
        b: { "0": [1, 1] },
        l: { "1": 1 },
      },
    }),
  });

  const path = join(root, "coverage.json");

  // All these parsers should handle the same format
  for (const tool of ["jest", "vitest", "playwright", "istanbul", "nyc"] as const) {
    const report = aggregateCoverage([{ tool, path }]);
    assert.equal(report.files.length, 1, `${tool} should parse successfully`);
    assert.equal(report.files[0].lines, 100, `${tool} should give 100% coverage`);
  }
});

test("aggregateCoverage - returns error for missing file", () => {
  const report = aggregateCoverage([
    { tool: "jest", path: "/nonexistent/coverage.json" },
  ]);
  assert.ok(report.error);
});

test("aggregateCoverage - merges multiple sources", () => {
  const root = fixture({
    "jest.json": JSON.stringify({
      "src/app.ts": {
        s: { "0": 1 },
        f: { "0": 1 },
        b: { "0": [1] },
        l: { "1": 1 },
      },
    }),
    "vitest.json": JSON.stringify({
      "src/app.ts": {
        s: { "0": 1, "1": 1 },
        f: { "0": 1, "1": 1 },
        b: { "0": [1], "1": [1] },
        l: { "1": 1, "2": 1 },
      },
    }),
  });

  const report = aggregateCoverage([
    { tool: "jest", path: join(root, "jest.json") },
    { tool: "vitest", path: join(root, "vitest.json") },
  ]);

  // After merge there should be 1 file
  assert.equal(report.files.length, 1);
});

// ---------------------------------------------------------------------------
// checkCoverageThreshold
// ---------------------------------------------------------------------------

test("checkCoverageThreshold - passes when all files exceed threshold", () => {
  const report: CoverageReport = {
    files: [
      { path: "src/app.ts", statements: 95, branches: 90, functions: 100, lines: 92, uncoveredLines: [] },
      { path: "src/utils.ts", statements: 88, branches: 85, functions: 90, lines: 87, uncoveredLines: [] },
    ],
    totalStatements: 200,
    coveredStatements: 183,
    totalBranches: 100,
    coveredBranches: 88,
    totalFunctions: 50,
    coveredFunctions: 48,
    totalLines: 150,
    coveredLines: 135,
    overallPercent: 90,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const result = checkCoverageThreshold(report, 80);
  assert.equal(result.pass, true);
  assert.deepEqual(result.details, []);
});

test("checkCoverageThreshold - fails when files below threshold", () => {
  const report: CoverageReport = {
    files: [
      { path: "src/app.ts", statements: 95, branches: 90, functions: 100, lines: 92, uncoveredLines: [] },
      { path: "src/poor.ts", statements: 50, branches: 40, functions: 60, lines: 45, uncoveredLines: [1, 2, 3] },
    ],
    totalStatements: 150,
    coveredStatements: 120,
    totalBranches: 80,
    coveredBranches: 65,
    totalFunctions: 40,
    coveredFunctions: 35,
    totalLines: 100,
    coveredLines: 80,
    overallPercent: 80,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const result = checkCoverageThreshold(report, 80);
  assert.equal(result.pass, false);
  assert.equal(result.details.length, 1);
  assert.equal(result.details[0].file, "src/poor.ts");
  assert.equal(result.details[0].percent, 45);
  assert.equal(result.details[0].threshold, 80);
});

test("checkCoverageThreshold - passes with no files", () => {
  const report: CoverageReport = {
    files: [],
    totalStatements: 0,
    coveredStatements: 0,
    totalBranches: 0,
    coveredBranches: 0,
    totalFunctions: 0,
    coveredFunctions: 0,
    totalLines: 0,
    coveredLines: 0,
    overallPercent: 0,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const result = checkCoverageThreshold(report, 80);
  assert.equal(result.pass, true);
  assert.deepEqual(result.details, []);
});

test("checkCoverageThreshold - uses line coverage as metric", () => {
  const report: CoverageReport = {
    files: [
      { path: "src/test.ts", statements: 100, branches: 100, functions: 100, lines: 70, uncoveredLines: [] },
    ],
    totalStatements: 10,
    coveredStatements: 10,
    totalBranches: 10,
    coveredBranches: 10,
    totalFunctions: 10,
    coveredFunctions: 10,
    totalLines: 10,
    coveredLines: 7,
    overallPercent: 70,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  // 70% line coverage should fail 75% threshold
  const result = checkCoverageThreshold(report, 75);
  assert.equal(result.pass, false);
  assert.equal(result.details[0].percent, 70);
});

// ---------------------------------------------------------------------------
// formatCoverageReport
// ---------------------------------------------------------------------------

test("formatCoverageReport - produces formatted output with summary", () => {
  const report: CoverageReport = {
    files: [
      { path: "src/app.ts", statements: 95, branches: 90, functions: 100, lines: 92, uncoveredLines: [] },
    ],
    totalStatements: 100,
    coveredStatements: 95,
    totalBranches: 50,
    coveredBranches: 45,
    totalFunctions: 20,
    coveredFunctions: 20,
    totalLines: 80,
    coveredLines: 74,
    overallPercent: 92,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatCoverageReport(report);
  assert.ok(output.includes("Coverage Report"));
  assert.ok(output.includes("Overall"));
  assert.ok(output.includes("Statements"));
  assert.ok(output.includes("Branches"));
  assert.ok(output.includes("Functions"));
  assert.ok(output.includes("Lines"));
  assert.ok(output.includes("src/app.ts"));
});

test("formatCoverageReport - shows error when present", () => {
  const report: CoverageReport = {
    files: [],
    totalStatements: 0,
    coveredStatements: 0,
    totalBranches: 0,
    coveredBranches: 0,
    totalFunctions: 0,
    coveredFunctions: 0,
    totalLines: 0,
    coveredLines: 0,
    overallPercent: 0,
    generatedAt: "2026-01-01T00:00:00.000Z",
    error: "File not found: missing.json",
  };

  const output = formatCoverageReport(report);
  assert.ok(output.includes("File not found"));
});

test("formatCoverageReport - shows 'No files' when empty", () => {
  const report: CoverageReport = {
    files: [],
    totalStatements: 0,
    coveredStatements: 0,
    totalBranches: 0,
    coveredBranches: 0,
    totalFunctions: 0,
    coveredFunctions: 0,
    totalLines: 0,
    coveredLines: 0,
    overallPercent: 0,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatCoverageReport(report);
  assert.ok(output.includes("No files in report"));
});

test("formatCoverageReport - shows low-coverage file section", () => {
  const report: CoverageReport = {
    files: [
      { path: "src/poor.ts", statements: 50, branches: 40, functions: 60, lines: 45, uncoveredLines: [1, 2, 3] },
    ],
    totalStatements: 10,
    coveredStatements: 5,
    totalBranches: 10,
    coveredBranches: 4,
    totalFunctions: 10,
    coveredFunctions: 6,
    totalLines: 10,
    coveredLines: 5,
    overallPercent: 50,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatCoverageReport(report);
  assert.ok(output.includes("Low-coverage"));
  assert.ok(output.includes("uncovered lines"));
});

test("formatCoverageReport - truncates large uncovered line lists", () => {
  const uncoveredLines = Array.from({ length: 20 }, (_, i) => i + 1);
  const report: CoverageReport = {
    files: [
      { path: "src/huge.ts", statements: 30, branches: 20, functions: 40, lines: 30, uncoveredLines },
    ],
    totalStatements: 100,
    coveredStatements: 30,
    totalBranches: 50,
    coveredBranches: 10,
    totalFunctions: 20,
    coveredFunctions: 8,
    totalLines: 100,
    coveredLines: 30,
    overallPercent: 30,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatCoverageReport(report);
  assert.ok(output.includes("uncovered lines"));
  // Should have the truncation indicator (+N more)
  assert.ok(output.includes("more"));
});
