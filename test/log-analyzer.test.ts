import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LogEntry } from "../src/log-analyzer.js";
import { analyzeLogFile, analyzeLogs, formatLogReport } from "../src/log-analyzer.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "log-analyzer-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(root, filePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// analyzeLogFile
// ---------------------------------------------------------------------------

test("analyzeLogFile - parses JSONL and produces report with errors and warnings", () => {
  const root = fixture({
    "app.log": [
      JSON.stringify({
        timestamp: "2026-01-01T10:00:00Z",
        level: "info",
        message: "Server started",
      }),
      JSON.stringify({
        timestamp: "2026-01-01T10:01:00Z",
        level: "error",
        message: "Connection refused",
      }),
      JSON.stringify({
        timestamp: "2026-01-01T10:02:00Z",
        level: "warn",
        message: "High memory usage",
      }),
      JSON.stringify({
        timestamp: "2026-01-01T10:03:00Z",
        level: "error",
        message: "Connection refused",
      }),
      JSON.stringify({
        timestamp: "2026-01-01T10:04:00Z",
        level: "info",
        message: "Request completed",
      }),
    ].join("\n"),
  });

  const report = analyzeLogFile(join(root, "app.log"));
  assert.equal(report.totalLines, 5);
  assert.equal(report.errorCount, 2);
  assert.equal(report.warnCount, 1);
  assert.equal(report.timeRange.first, "2026-01-01T10:00:00Z");
  assert.equal(report.timeRange.last, "2026-01-01T10:04:00Z");
});

test("analyzeLogFile - groups similar errors by normalised message", () => {
  const root = fixture({
    "app.log": [
      JSON.stringify({
        timestamp: "2026-01-01T10:00:00Z",
        level: "error",
        message: "Timeout on port 3000",
      }),
      JSON.stringify({
        timestamp: "2026-01-01T10:01:00Z",
        level: "error",
        message: "Timeout on port 4000",
      }),
    ].join("\n"),
  });

  const report = analyzeLogFile(join(root, "app.log"));
  // Both should be grouped together because numeric values are replaced
  assert.equal(report.errorGroups.length, 1);
  assert.equal(report.errorGroups[0].count, 2);
});

test("analyzeLogFile - detects top errors by exact message", () => {
  const root = fixture({
    "app.log": [
      JSON.stringify({ timestamp: "2026-01-01T10:00:00Z", level: "error", message: "DB timeout" }),
      JSON.stringify({ timestamp: "2026-01-01T10:01:00Z", level: "error", message: "DB timeout" }),
      JSON.stringify({ timestamp: "2026-01-01T10:02:00Z", level: "error", message: "OOM" }),
    ].join("\n"),
  });

  const report = analyzeLogFile(join(root, "app.log"));
  assert.equal(report.topErrors.length, 2);
  assert.equal(report.topErrors[0].message, "DB timeout");
  assert.equal(report.topErrors[0].count, 2);
});

test("analyzeLogFile - handles empty file", () => {
  const root = fixture({ "empty.log": "" });
  const report = analyzeLogFile(join(root, "empty.log"));
  assert.equal(report.totalLines, 0);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warnCount, 0);
  assert.equal(report.timeRange.first, null);
  assert.equal(report.timeRange.last, null);
  assert.deepEqual(report.errorGroups, []);
  assert.deepEqual(report.topErrors, []);
  assert.deepEqual(report.frequencyByMinute, []);
});

test("analyzeLogFile - handles malformed JSON lines as raw text", () => {
  const root = fixture({
    "app.log": [
      JSON.stringify({ timestamp: "2026-01-01T10:00:00Z", level: "info", message: "ok" }),
      "not valid json at all",
      JSON.stringify({ timestamp: "2026-01-01T10:02:00Z", level: "error", message: "real error" }),
    ].join("\n"),
  });

  const report = analyzeLogFile(join(root, "app.log"));
  // malformed line is still counted with _raw: true
  assert.equal(report.totalLines, 3);
  // Only the valid JSON error should be counted as error
  assert.equal(report.errorCount, 1);
});

test("analyzeLogFile - raw text lines with timestamps still get extracted", () => {
  const root = fixture({
    "app.log": "2026-06-01T12:00:00Z some random text line\n2026-06-01T12:01:00Z another line\n",
  });

  const report = analyzeLogFile(join(root, "app.log"));
  assert.equal(report.totalLines, 2);
  assert.equal(report.timeRange.first, "2026-06-01T12:00:00Z");
  assert.equal(report.timeRange.last, "2026-06-01T12:01:00Z");
});

test("analyzeLogFile - frequencyByMinute tracks per-minute counts", () => {
  const lines = [
    JSON.stringify({ timestamp: "2026-01-01T10:00:00Z", level: "info", message: "a" }),
    JSON.stringify({ timestamp: "2026-01-01T10:00:30Z", level: "info", message: "b" }),
    JSON.stringify({ timestamp: "2026-01-01T10:01:00Z", level: "info", message: "c" }),
  ].join("\n");
  const root = fixture({ "app.log": lines });

  const report = analyzeLogFile(join(root, "app.log"));
  assert.equal(report.frequencyByMinute.length, 2);
  assert.equal(report.frequencyByMinute[0].time, "2026-01-01T10:00");
  assert.equal(report.frequencyByMinute[0].count, 2);
  assert.equal(report.frequencyByMinute[1].time, "2026-01-01T10:01");
  assert.equal(report.frequencyByMinute[1].count, 1);
});

// ---------------------------------------------------------------------------
// analyzeLogs (pure, no I/O)
// ---------------------------------------------------------------------------

test("analyzeLogs - empty entries returns zeroed report", () => {
  const report = analyzeLogs([]);
  assert.equal(report.totalLines, 0);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warnCount, 0);
});

test("analyzeLogs - severity assessment: high for critical terms", () => {
  const entries: LogEntry[] = [
    { timestamp: "2026-01-01T00:00:00Z", level: "error", message: "fatal: something broke" },
  ];
  const report = analyzeLogs(entries);
  assert.equal(report.errorGroups.length, 1);
  assert.equal(report.errorGroups[0].severity, "high");
});

test("analyzeLogs - severity assessment: high for count >= 50", () => {
  const entries: LogEntry[] = [];
  for (let i = 0; i < 50; i++) {
    entries.push({ timestamp: "2026-01-01T00:00:00Z", level: "error", message: "many errors" });
  }
  const report = analyzeLogs(entries);
  assert.equal(report.errorGroups.length, 1);
  assert.equal(report.errorGroups[0].severity, "high");
});

test("analyzeLogs - severity assessment: medium for count >= 10", () => {
  const entries: LogEntry[] = [];
  for (let i = 0; i < 15; i++) {
    entries.push({ timestamp: "2026-01-01T00:00:00Z", level: "error", message: "some errors" });
  }
  const report = analyzeLogs(entries);
  assert.equal(report.errorGroups.length, 1);
  assert.equal(report.errorGroups[0].severity, "medium");
});

test("analyzeLogs - severity assessment: low for few non-critical errors", () => {
  const entries: LogEntry[] = [
    { timestamp: "2026-01-01T00:00:00Z", level: "error", message: "minor issue" },
  ];
  const report = analyzeLogs(entries);
  assert.equal(report.errorGroups.length, 1);
  assert.equal(report.errorGroups[0].severity, "low");
});

// ---------------------------------------------------------------------------
// formatLogReport
// ---------------------------------------------------------------------------

test("formatLogReport - produces markdown with overview", () => {
  const report = {
    totalLines: 100,
    errorCount: 5,
    warnCount: 3,
    timeRange: { first: "2026-01-01T00:00:00Z", last: "2026-01-01T01:00:00Z" },
    errorGroups: [],
    topErrors: [],
    frequencyByMinute: [],
  };

  const output = formatLogReport(report);
  assert.ok(output.includes("Log Analysis Report"));
  assert.ok(output.includes("Total lines"));
  assert.ok(output.includes("Errors"));
  assert.ok(output.includes("Warnings"));
  assert.ok(output.includes("Time range"));
  assert.ok(output.includes("2026-01-01T00:00:00Z"));
});

test("formatLogReport - includes top errors table", () => {
  const report = {
    totalLines: 10,
    errorCount: 2,
    warnCount: 0,
    timeRange: { first: null, last: null },
    errorGroups: [],
    topErrors: [{ message: "DB timeout", count: 2 }],
    frequencyByMinute: [],
  };

  const output = formatLogReport(report);
  assert.ok(output.includes("Top Errors"));
  assert.ok(output.includes("DB timeout"));
  assert.ok(output.includes("2"));
});

test("formatLogReport - includes error groups table", () => {
  const report = {
    totalLines: 10,
    errorCount: 2,
    warnCount: 0,
    timeRange: { first: null, last: null },
    errorGroups: [
      { pattern: "timeout", count: 2, example: "Timeout on port 3000", severity: "high" as const },
    ],
    topErrors: [],
    frequencyByMinute: [],
  };

  const output = formatLogReport(report);
  assert.ok(output.includes("Error Groups"));
  assert.ok(output.includes("timeout"));
  assert.ok(output.includes("high"));
});

test("formatLogReport - includes frequency bar chart", () => {
  const report = {
    totalLines: 5,
    errorCount: 0,
    warnCount: 0,
    timeRange: { first: null, last: null },
    errorGroups: [],
    topErrors: [],
    frequencyByMinute: [{ time: "2026-01-01T10:00", count: 3 }],
  };

  const output = formatLogReport(report);
  assert.ok(output.includes("Frequency by Minute"));
  assert.ok(output.includes("2026-01-01T10:00"));
  assert.ok(output.includes("3"));
});

test("formatLogReport - shows 'No timestamps found' when timeRange is null", () => {
  const report = {
    totalLines: 0,
    errorCount: 0,
    warnCount: 0,
    timeRange: { first: null, last: null },
    errorGroups: [],
    topErrors: [],
    frequencyByMinute: [],
  };

  const output = formatLogReport(report);
  assert.ok(output.includes("No timestamps found"));
});
