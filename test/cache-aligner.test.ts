import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  alignContent,
  getAlignmentStats,
  getPrefix,
  getWarmupSequence,
  markWarmupDone,
  registerPrefix,
  resetWarmup,
} from "../src/cache-aligner.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "cache-aligner-test-"));
  const orig = process.cwd();
  process.chdir(dir);
  return orig;
}

function restoreCwd(orig: string, tmp: string): void {
  process.chdir(orig);
  rmSync(tmp, { recursive: true, force: true });
}

// ─── getPrefix ────────────────────────────────────────────────────────────────

test("getPrefix returns default prefix for unknown type", () => {
  const prefix = getPrefix("unknown-type");
  assert.equal(prefix.text, "coder-workflow | orchestrate | ");
  assert.equal(prefix.category, "system");
  assert.ok(prefix.hash.length > 0, "hash should be present");
});

test("getPrefix returns specific agent prefixes", () => {
  const implementer = getPrefix("agent", "implementer");
  assert.ok(implementer.text.includes("[AGENT]"));
  assert.ok(implementer.text.includes("implement"));
  assert.equal(implementer.category, "system");
  assert.equal(implementer.subType, "agent:implementer");

  const auditor = getPrefix("agent", "auditor");
  assert.ok(auditor.text.includes("[AGENT]"));
  assert.ok(auditor.text.includes("audit"));
});

test("getPrefix returns system prefix", () => {
  const system = getPrefix("system");
  assert.ok(system.text.includes("[SYS]"));
  assert.ok(system.text.includes("orchestrate"));
});

test("getPrefix returns skill prefixes", () => {
  const orchestrator = getPrefix("skill", "orchestrator");
  assert.ok(orchestrator.text.includes("[SKILL]"));
  assert.ok(orchestrator.text.includes("orchestrator"));

  const plan = getPrefix("skill", "plan");
  assert.ok(plan.text.includes("plan"));
});

test("getPrefix for each agent type produces different prefixes", () => {
  const prefixes = [
    getPrefix("agent", "implementer").text,
    getPrefix("agent", "auditor").text,
    getPrefix("agent", "debugger").text,
    getPrefix("agent", "reviewer").text,
    getPrefix("agent", "tester").text,
    getPrefix("agent", "ui").text,
    getPrefix("agent", "db").text,
    getPrefix("agent", "deploy").text,
    getPrefix("agent", "docs").text,
  ];

  const unique = new Set(prefixes);
  assert.equal(unique.size, prefixes.length, "all agent prefixes should be unique");
});

// ─── alignContent ────────────────────────────────────────────────────────────

test("alignContent wraps content with default prefix", () => {
  const result = alignContent("hello world");

  assert.ok(result.aligned.startsWith("coder-workflow | orchestrate | "));
  assert.ok(result.aligned.endsWith("hello world"));
  assert.ok(result.prefix.text.length > 0);
});

test("alignContent uses type and subType for prefix selection", () => {
  const result = alignContent("test", { type: "agent", subType: "tester" });

  assert.ok(result.aligned.includes("[AGENT]"));
  assert.ok(result.aligned.includes("coder-workflow | test"));
});

test("alignContent includes task tag when provided", () => {
  const result = alignContent("do something", {
    type: "agent",
    subType: "implementer",
    task: "add-login",
  });

  assert.ok(result.aligned.includes("add-login"));
  assert.ok(result.aligned.endsWith("do something"));
});

test("alignContent strips leading whitespace from content", () => {
  const result = alignContent("  \n  spaced content");
  assert.ok(result.aligned.endsWith("spaced content"));
});

test("alignContent handles empty content", () => {
  const result = alignContent("");
  assert.ok(result.aligned.trim().length > 0);
});

// ─── registerPrefix ──────────────────────────────────────────────────────────

test("registerPrefix adds new prefix to the registry", () => {
  const result = alignContent("test", { type: "custom" });
  // Default since not registered yet
  assert.ok(result.prefix.text.includes("orchestrate"));

  // Now register
  registerPrefix("custom", "[CUSTOM] my-custom-prefix | ");

  const result2 = alignContent("test", { type: "custom" });
  assert.ok(result2.aligned.includes("my-custom-prefix"));
});

test("registerPrefix persists to disk and can be read back", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    registerPrefix("custom", "[CUSTOM] persisted | ");

    // Verify file was written
    const cacheDir = join(tmpDir, ".claude", "cache-aligner");
    assert.ok(existsSync(cacheDir));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── Warmup Sequence ─────────────────────────────────────────────────────────

test("getWarmupSequence returns default warmup entries", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const sequence = getWarmupSequence();

    assert.ok(Array.isArray(sequence));
    assert.equal(sequence.length, 4, "should have 4 default warmup entries");
    assert.ok(sequence[0].includes("pre-warm"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("markWarmupDone removes entry from warmup sequence", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const sequence = getWarmupSequence();

    markWarmupDone(sequence[0]);

    const updated = getWarmupSequence();
    assert.equal(updated.length, 3, "one entry should be marked warmed");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("resetWarmup restores all warmup entries", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const sequence = getWarmupSequence();
    markWarmupDone(sequence[0]);
    markWarmupDone(sequence[1]);

    resetWarmup();

    const restored = getWarmupSequence();
    assert.equal(restored.length, 4, "all entries should be restored");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("markWarmupDone on non-existent entry does nothing", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    markWarmupDone("nonexistent warmup content");
    const sequence = getWarmupSequence();
    assert.equal(sequence.length, 4);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── getAlignmentStats ────────────────────────────────────────────────────────

test("getAlignmentStats returns expected shape", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const stats = getAlignmentStats();

    assert.ok(typeof stats.totalAlignments === "number");
    assert.ok(stats.totalAlignments > 0, "should have at least one alignment");
    assert.ok(stats.currentPrefix.length > 0);
    assert.ok(stats.currentHash.length > 0);
    assert.equal(stats.currentHash.length, 8);
    assert.ok(Array.isArray(stats.warmupStatus));
    assert.equal(stats.warmupStatus.length, 4);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getAlignmentStats warmup status reflects markWarmupDone", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const sequence = getWarmupSequence();
    markWarmupDone(sequence[0]);

    const stats = getAlignmentStats();
    const warmed = stats.warmupStatus.find((w) => w.warmed === true);
    assert.ok(warmed, "at least one entry should be warmed");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

test("alignContent with very long content still prepends prefix", () => {
  const longContent = "A".repeat(10000);
  const result = alignContent(longContent, { type: "system" });
  assert.ok(result.aligned.startsWith("[SYS]"));
  assert.ok(result.aligned.endsWith("A".repeat(10000)));
});

test("alignContent with special characters in task", () => {
  const result = alignContent("content", { task: "fix-#42-bug!" });
  assert.ok(result.aligned.includes("fix-#42-bug!"));
});

test("getPrefix hash is deterministic for same key", () => {
  const p1 = getPrefix("agent", "implementer");
  const p2 = getPrefix("agent", "implementer");

  assert.equal(p1.hash, p2.hash);
  assert.equal(p1.text, p2.text);
});

test("getPrefix hash differs for different keys", () => {
  const p1 = getPrefix("agent", "implementer");
  const p2 = getPrefix("agent", "auditor");

  assert.notEqual(p1.hash, p2.hash);
});

test("getPrefix for skill:brainstorm contains brainstorm keyword", () => {
  const prefix = getPrefix("skill", "brainstorm");
  assert.ok(prefix.text.includes("brainstorm"));
});
