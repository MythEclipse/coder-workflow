import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BenchmarkResult, PRStatus, SprintReport, TeamMetrics } from "../src/tier3.js";
import {
  checkPRAutoMerge,
  detectBenchmarkRegression,
  generateSprintReport,
  getBenchmarkHistory,
  getTeamMetrics,
  recordBenchmark,
} from "../src/tier3.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-tier3-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ─── Constants ──────────────────────────────────────────────────────────

test("AVG_REVIEW_TIME_HOURS constant is documented in TeamMetrics", () => {
  // AVG_REVIEW_TIME_HOURS is internal (not exported), but used in getTeamMetrics
  // which returns avgReviewTimeHours: 4.2
  const metrics = getTeamMetrics();
  assert.equal(typeof metrics.avgReviewTimeHours, "number");
  assert.equal(metrics.avgReviewTimeHours, 4.2);
});

// ─── recordBenchmark / getBenchmarkHistory ──────────────────────────────

test("recordBenchmark records and returns a benchmark result", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const result = recordBenchmark("test-suite", 42);
    assert.equal(result.name, "test-suite");
    assert.equal(result.duration, 42);
    assert.ok(typeof result.timestamp === "string");
    assert.ok(typeof result.commit === "string");
  } finally {
    process.chdir(origCwd);
  }
});

test("getBenchmarkHistory returns recorded benchmarks", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    recordBenchmark("perf-test", 100);
    recordBenchmark("perf-test", 200);

    const history = getBenchmarkHistory("perf-test");
    assert.equal(history.length, 2);
    assert.equal(history[0].name, "perf-test");
    assert.equal(history[0].duration, 100);
    assert.equal(history[1].duration, 200);
  } finally {
    process.chdir(origCwd);
  }
});

test("getBenchmarkHistory respects limit parameter", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    recordBenchmark("limited-test", 10);
    recordBenchmark("limited-test", 20);
    recordBenchmark("limited-test", 30);

    const history = getBenchmarkHistory("limited-test", 2);
    assert.equal(history.length, 2);
    assert.equal(history[history.length - 1].duration, 30);
  } finally {
    process.chdir(origCwd);
  }
});

test("getBenchmarkHistory returns empty array for nonexistent benchmark", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const history = getBenchmarkHistory("nonexistent");
    assert.deepEqual(history, []);
  } finally {
    process.chdir(origCwd);
  }
});

test("detectBenchmarkRegression returns null with insufficient data", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    recordBenchmark("regression-test", 100);

    const result = detectBenchmarkRegression("regression-test");
    assert.equal(result, null);
  } finally {
    process.chdir(origCwd);
  }
});

test("detectBenchmarkRegression detects when performance regressed > 10%", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    recordBenchmark("my-bench", 100);
    recordBenchmark("my-bench", 100);
    // Regression: 200 vs avg of first two (100) = 100% change
    recordBenchmark("my-bench", 200);

    const result = detectBenchmarkRegression("my-bench");
    assert.ok(result);
    assert.equal(result.regressed, true);
    assert.ok(result.change > 10);
    assert.equal(result.current, 200);
  } finally {
    process.chdir(origCwd);
  }
});

test("detectBenchmarkRegression does not flag improvement < 10%", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    recordBenchmark("stable-bench", 100);
    recordBenchmark("stable-bench", 102);
    recordBenchmark("stable-bench", 103);

    const result = detectBenchmarkRegression("stable-bench");
    assert.ok(result);
    assert.equal(result.regressed, false);
    assert.ok(result.change <= 10);
  } finally {
    process.chdir(origCwd);
  }
});

test("detectBenchmarkRegression computes change percentage", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    recordBenchmark("calc-bench", 100);
    recordBenchmark("calc-bench", 110);

    const result = detectBenchmarkRegression("calc-bench");
    assert.ok(result);
    assert.equal(result.current, 110);
    assert.equal(result.previous, 100);
    assert.equal(result.change, 10);
  } finally {
    process.chdir(origCwd);
  }
});

test("BenchmarkResult type contract", () => {
  const result: BenchmarkResult = {
    name: "test",
    duration: 50,
    timestamp: "2024-01-01T00:00:00.000Z",
    commit: "abc1234",
  };

  assert.equal(result.name, "test");
  assert.equal(result.duration, 50);
  assert.equal(typeof result.timestamp, "string");
  assert.ok(result.commit.length > 0);
});

// ─── generateSprintReport / getTeamMetrics ──────────────────────────────

test("generateSprintReport and getTeamMetrics are exported functions", () => {
  assert.equal(typeof generateSprintReport, "function");
  assert.equal(typeof getTeamMetrics, "function");
});

test("generateSprintReport returns SprintReport shape", () => {
  const report = generateSprintReport();
  assert.ok(typeof report.totalCommits === "number");
  assert.ok(typeof report.filesChanged === "number");
  assert.ok(typeof report.insertions === "number");
  assert.ok(typeof report.deletions === "number");
  assert.ok(Array.isArray(report.authors));
  assert.ok(Array.isArray(report.byAuthor));
  assert.ok(report.period.from === "7.days.ago");
  assert.ok(report.period.to === "now");
});

test("generateSprintReport returns valid data for a period with commits", () => {
  const report = generateSprintReport("30.days.ago");

  assert.ok(typeof report.totalCommits === "number");
  assert.ok(report.totalCommits >= 0);
  assert.ok(report.filesChanged >= 0);
  assert.ok(report.insertions >= 0);
  assert.ok(report.deletions >= 0);
  assert.ok(Array.isArray(report.authors));
  assert.ok(Array.isArray(report.byAuthor));

  // byAuthor entries should match authors
  for (const author of report.byAuthor) {
    assert.ok(report.authors.includes(author.name));
    assert.ok(typeof author.commits === "number");
    assert.ok(typeof author.insertions === "number");
    assert.ok(typeof author.deletions === "number");
  }
});

test("SprintReport type contract", () => {
  const report: SprintReport = {
    totalCommits: 10,
    filesChanged: 25,
    insertions: 500,
    deletions: 100,
    authors: ["alice", "bob"],
    byAuthor: [
      { name: "alice", commits: 6, insertions: 300, deletions: 50 },
      { name: "bob", commits: 4, insertions: 200, deletions: 50 },
    ],
    period: { from: "7.days.ago", to: "now" },
  };

  assert.equal(report.totalCommits, 10);
  assert.equal(report.authors.length, 2);
  assert.equal(report.byAuthor[0].name, "alice");
  assert.equal(report.period.from, "7.days.ago");
});

test("TeamMetrics type contract", () => {
  const sprint: SprintReport = {
    totalCommits: 0,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    authors: [],
    byAuthor: [],
    period: { from: "", to: "" },
  };

  const metrics: TeamMetrics = {
    sprint,
    openPRs: 3,
    staleBranches: 5,
    unreviewedPRs: 1,
    avgReviewTimeHours: 4.2,
  };

  assert.equal(metrics.openPRs, 3);
  assert.equal(metrics.staleBranches, 5);
  assert.equal(metrics.unreviewedPRs, 1);
  assert.equal(metrics.avgReviewTimeHours, 4.2);
});

// ─── checkPRAutoMerge ───────────────────────────────────────────────────

test("checkPRAutoMerge returns PRStatus shape", async () => {
  const result = await checkPRAutoMerge(0);

  assert.equal(typeof result.number, "number");
  assert.equal(typeof result.title, "string");
  assert.equal(typeof result.checksPass, "boolean");
  assert.equal(typeof result.reviewsApproved, "boolean");
  assert.equal(typeof result.upToDate, "boolean");
  assert.equal(typeof result.noConflict, "boolean");
  assert.equal(typeof result.canAutoMerge, "boolean");
});

test("PRStatus type contract", () => {
  const status: PRStatus = {
    number: 42,
    title: "Fix bug",
    checksPass: true,
    reviewsApproved: true,
    upToDate: true,
    noConflict: true,
    canAutoMerge: true,
  };

  assert.equal(status.number, 42);
  assert.equal(status.title, "Fix bug");
  assert.equal(status.canAutoMerge, true);
});
