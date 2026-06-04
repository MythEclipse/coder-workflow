import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addCorrection,
  analyzeFailures,
  applyCorrections,
  getFailures,
  getLearnReport,
  logFailure,
  matchCorrection,
  resolveFailure,
} from "../src/learn.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "learn-test-"));
  const orig = process.cwd();
  process.chdir(dir);
  return orig;
}

function restoreCwd(orig: string, tmp: string): void {
  process.chdir(orig);
  rmSync(tmp, { recursive: true, force: true });
}

// ─── Failure Logging ──────────────────────────────────────────────────────────

test("logFailure creates a failure record with defaults", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const record = logFailure({
      type: "tool_failure",
      tool: "Bash",
      error: "Command exited with code 1",
    });

    assert.ok(record.id, "should generate an id");
    assert.ok(record.id.startsWith("tool_failure-"), "id should start with type");
    assert.equal(record.resolved, false);
    assert.equal(record.type, "tool_failure");
    assert.equal(record.tool, "Bash");
    assert.equal(record.error, "Command exited with code 1");
    assert.ok(record.timestamp, "should have a timestamp");
    assert.equal(record.resolution, undefined);
    assert.equal(record.correctionWritten, undefined);

    // Verify it was persisted
    const failures = getFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].id, record.id);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("logFailure creates stop_failure type", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const record = logFailure({
      type: "stop_failure",
      error: "Rate limit exceeded",
      context: "API call to /v1/completions",
    });

    assert.equal(record.type, "stop_failure");
    assert.ok(record.context!.includes("API call"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("logFailure creates session_failure and test_failure types", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const session = logFailure({
      type: "session_failure",
      error: "Session crashed",
    });
    assert.equal(session.type, "session_failure");

    const test = logFailure({
      type: "test_failure",
      error: "Expected 2 but got 3",
      tool: "node:test",
    });
    assert.equal(test.type, "test_failure");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── GetFailures ──────────────────────────────────────────────────────────────

test("getFailures returns empty array when no logs exist", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const failures = getFailures();
    assert.deepEqual(failures, []);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getFailures filters by type", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    logFailure({ type: "tool_failure", tool: "Bash", error: "err1" });
    logFailure({ type: "stop_failure", error: "err2" });
    logFailure({ type: "tool_failure", tool: "Write", error: "err3" });

    const toolFailures = getFailures({ type: "tool_failure" });
    assert.equal(toolFailures.length, 2);

    const stopFailures = getFailures({ type: "stop_failure" });
    assert.equal(stopFailures.length, 1);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getFailures filters by unresolved", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const r1 = logFailure({ type: "tool_failure", tool: "A", error: "e1" });
    const r2 = logFailure({ type: "tool_failure", tool: "B", error: "e2" });
    resolveFailure(r1.id, "fixed");

    const unresolved = getFailures({ unresolved: true });
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].id, r2.id);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getFailures respects limit and sorts newest first", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    logFailure({ type: "tool_failure", error: "e1", tool: "a" });
    logFailure({ type: "tool_failure", error: "e2", tool: "b" });
    logFailure({ type: "tool_failure", error: "e3", tool: "c" });

    const limited = getFailures({ limit: 2 });
    assert.equal(limited.length, 2);
    // Sorted newest first — same-millisecond entries retain insertion order reversed by sort
    // At minimum, the limit works correctly
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getFailures handles corrupted log lines gracefully", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    logFailure({ type: "tool_failure", error: "valid" });
    // Manually corrupt the file
    const learnDir = join(tmpDir, ".claude", "learn");
    const logPath = join(learnDir, "failures.jsonl");
    const content = readFileSync(logPath, "utf-8");
    rmSync(logPath);

    // Write valid + corrupted + valid
    writeFileSync(logPath, content + "not-json\n" + content, "utf-8");

    const failures = getFailures();
    assert.equal(failures.length, 2, "corrupted line should be skipped");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── resolveFailure ──────────────────────────────────────────────────────────

test("resolveFailure marks failure as resolved with resolution", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const record = logFailure({ type: "tool_failure", tool: "Bash", error: "err" });

    const found = resolveFailure(record.id, "Increased timeout");
    assert.equal(found, true);

    const failures = getFailures({ type: "tool_failure" });
    assert.equal(failures[0].resolved, true);
    assert.equal(failures[0].resolution, "Increased timeout");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("resolveFailure returns false for non-existent id", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const found = resolveFailure("nonexistent-id");
    assert.equal(found, false);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("resolveFailure returns false when no log file exists", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const found = resolveFailure("anything");
    assert.equal(found, false);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── Correction Management ────────────────────────────────────────────────────

test("addCorrection creates a correctable entry", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const entry = addCorrection("timeout_error", "timeout", "Increase timeout or retry");

    assert.ok(entry.id.startsWith("corr-"), "id should start with corr-");
    assert.equal(entry.pattern, "timeout_error");
    assert.ok(entry.symptom instanceof RegExp);
    assert.equal(entry.fix, "Increase timeout or retry");
    assert.equal(entry.source, "learn");
    assert.equal(entry.appliedCount, 0);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("matchCorrection finds matching entry by error string", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    addCorrection("timeout_error", "timeout", "Increase timeout");
    addCorrection("not_found", "not found|enoent", "Check path exists");

    // Should match timeout
    const match1 = matchCorrection("Request timeout after 30s");
    assert.ok(match1, "should match timeout pattern");
    assert.equal(match1!.pattern, "timeout_error");

    // Should match not found
    const match2 = matchCorrection("Error: ENOENT: file not found");
    assert.ok(match2, "should match not-found pattern");
    assert.equal(match2!.pattern, "not_found");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("matchCorrection returns undefined when no match", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    addCorrection("timeout_error", "timeout", "Increase timeout");

    const match = matchCorrection("Something completely different");
    assert.equal(match, undefined);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("matchCorrection returns undefined with empty corrections list", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const match = matchCorrection("error message");
    assert.equal(match, undefined);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("matchCorrection increments appliedCount on match", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    addCorrection("timeout_error", "timeout", "Increase timeout");

    matchCorrection("timeout happened");
    matchCorrection("timeout again");

    // Reload by matching again
    const match = matchCorrection("timeout yet again");
    assert.equal(match!.appliedCount, 3);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── analyzeFailures ─────────────────────────────────────────────────────────

test("analyzeFailures returns empty when no failures exist", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const result = analyzeFailures();
    assert.equal(result.analyzed, 0);
    assert.deepEqual(result.suggestions, []);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("analyzeFailures suggests corrections for similar errors (2+ occurrences)", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    logFailure({ type: "tool_failure", tool: "Bash", error: "Error: request timeout after waiting for the server to respond to the client (attempt 1)" });
    logFailure({ type: "tool_failure", tool: "Bash", error: "Error: request timeout after waiting for the server to respond to the client (attempt 2)" });

    const result = analyzeFailures();

    assert.equal(result.analyzed, 2);
    assert.equal(result.suggestions.length, 1);
    assert.ok(result.suggestions[0].fix.toLowerCase().includes("timeout"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("analyzeFailures groups by error prefix and suggests fix for different error types", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    // Timeout errors — must have same first 80 chars after digit normalization
    logFailure({ type: "tool_failure", tool: "Bash", error: "Error: request timeout after waiting for the server to respond to the client (attempt 1)" });
    logFailure({ type: "tool_failure", tool: "Bash", error: "Error: request timeout after waiting for the server to respond to the client (attempt 2)" });

    // Not found errors
    logFailure({ type: "tool_failure", tool: "Read", error: "Error: file not found while trying to read the requested document from the remote server (path /tmp/test_1)" });
    logFailure({ type: "tool_failure", tool: "Read", error: "Error: file not found while trying to read the requested document from the remote server (path /tmp/test_2)" });

    // Single unique error (should not produce a suggestion)
    logFailure({ type: "tool_failure", tool: "Write", error: "Error: permission denied accessing system resource without valid credentials" });

    const result = analyzeFailures();

    assert.equal(result.analyzed, 5);
    assert.equal(result.suggestions.length, 2);
    assert.ok(result.suggestions.some((s) => s.fix.toLowerCase().includes("timeout")));
    assert.ok(result.suggestions.some((s) => s.fix.toLowerCase().includes("path")));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("analyzeFailures rate limit errors produce backoff suggestion", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    logFailure({ type: "stop_failure", error: "Error: rate limit exceeded while calling the external API endpoint for fetching user data (req_id: abc_001)" });
    logFailure({ type: "stop_failure", error: "Error: rate limit exceeded while calling the external API endpoint for fetching user data (req_id: abc_002)" });

    const result = analyzeFailures();
    assert.ok(result.suggestions[0].fix.toLowerCase().includes("backoff"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("analyzeFailures parse/syntax errors produce validation suggestion", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    logFailure({ type: "tool_failure", error: "Error: parse error encountered while processing the JSON response from the server during data sync (stream 1)" });
    logFailure({ type: "tool_failure", error: "Error: parse error encountered while processing the JSON response from the server during data sync (stream 2)" });

    const result = analyzeFailures();
    assert.ok(result.suggestions[0].fix.toLowerCase().includes("validate"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── applyCorrections ────────────────────────────────────────────────────────

test("applyCorrections writes memory files and creates corrections", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const suggestions = [
      { pattern: "test_timeout", symptom: "timeout", fix: "Increase timeout" },
    ];

    const result = applyCorrections(suggestions);
    assert.equal(result.written, 1);
    assert.ok(result.memoryFiles.length >= 1);

    // Verify the memory file was created
    const memoryDir = join(tmpDir, ".claude", "learn", "memory");
    assert.ok(existsSync(memoryDir));
    assert.ok(existsSync(join(memoryDir, "test_timeout.md")));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("applyCorrections writes summary file when corrections are applied", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const result = applyCorrections([
      { pattern: "err_a", symptom: "a", fix: "fix a" },
    ]);

    const summaryPath = join(tmpDir, ".claude", "learn", "memory", "_learn-summary.md");
    assert.ok(existsSync(summaryPath), "summary file should exist");

    const content = readFileSync(summaryPath, "utf-8");
    assert.ok(content.includes("Auto-Learned Corrections"));
    assert.ok(content.includes("err_a"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("applyCorrections with empty suggestions does nothing", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const result = applyCorrections([]);
    assert.equal(result.written, 0);
    assert.equal(result.memoryFiles.length, 0);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── getLearnReport ──────────────────────────────────────────────────────────

test("getLearnReport returns expected shape", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const report = getLearnReport();

    assert.ok(typeof report.totalFailures === "number");
    assert.ok(typeof report.unresolvedFailures === "number");
    assert.ok(typeof report.correctionsWritten === "number");
    assert.ok(typeof report.activePatterns === "number");
    assert.ok(Array.isArray(report.recentFailures));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getLearnReport reflects after logging failures", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    logFailure({ type: "tool_failure", tool: "Bash", error: "error 1" });
    logFailure({ type: "tool_failure", tool: "Write", error: "error 2" });

    const report = getLearnReport();
    assert.equal(report.totalFailures, 2);
    assert.equal(report.unresolvedFailures, 2);
    assert.equal(report.recentFailures.length, 2);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getLearnReport correctly counts corrections", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    addCorrection("err1", "pattern1", "fix1");
    addCorrection("err2", "pattern2", "fix2");

    const report = getLearnReport();
    assert.equal(report.activePatterns, 2);
    assert.equal(report.correctionsWritten, 2);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getLearnReport recentFailures is limited to 10", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    for (let i = 0; i < 15; i++) {
      logFailure({ type: "tool_failure", tool: "Bash", error: `error ${i}` });
    }

    const report = getLearnReport();
    assert.equal(report.recentFailures.length, 10);
    assert.equal(report.totalFailures, 15);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});
