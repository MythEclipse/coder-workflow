import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  alignCache,
  getCacheAlignment,
} from "../src/compress.js";

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

// ─── alignCache ────────────────────────────────────────────────────────────────

test("alignCache wraps content with project prefix", () => {
  const result = alignCache("hello world");

  assert.ok(result.aligned.startsWith("[PROJECT] coder-workflow |"));
  assert.ok(result.aligned.endsWith("hello world"));
  assert.ok(result.cacheable === true);
});

test("alignCache includes task type tag when provided", () => {
  const result = alignCache("do something", { taskType: "implement" });

  assert.ok(result.aligned.includes("task:implement"));
  assert.ok(result.aligned.endsWith("do something"));
});

test("alignCache includes mode tag when provided", () => {
  const result = alignCache("content", { mode: "strict" });

  assert.ok(result.aligned.includes("mode:strict"));
});

test("alignCache strips leading whitespace from content", () => {
  const result = alignCache("  \n  spaced content");
  assert.ok(result.aligned.endsWith("spaced content"));
});

test("alignCache handles empty content", () => {
  const result = alignCache("");
  assert.ok(result.aligned.trim().length > 0);
});

test("alignCache with very long content still prepends prefix", () => {
  const longContent = "A".repeat(10000);
  const result = alignCache(longContent, { taskType: "system" });
  assert.ok(result.aligned.startsWith("[PROJECT]"));
  assert.ok(result.aligned.endsWith("A".repeat(10000)));
});

test("alignCache with project name override", () => {
  const result = alignCache("content", { projectName: "my-project" });
  assert.ok(result.aligned.includes("my-project"));
});

test("alignCache hash is deterministic for same options", () => {
  const r1 = alignCache("content", { taskType: "implement" });
  const r2 = alignCache("content", { taskType: "implement" });

  assert.equal(r1.prefixHash, r2.prefixHash);
});

test("alignCache hash differs for different task types", () => {
  const r1 = alignCache("content", { taskType: "implement" });
  const r2 = alignCache("content", { taskType: "audit" });

  assert.notEqual(r1.prefixHash, r2.prefixHash);
});

// ─── getCacheAlignment ────────────────────────────────────────────────────────

test("getCacheAlignment returns expected shape", () => {
  const result = getCacheAlignment();

  assert.ok(typeof result.prefix === "string");
  assert.ok(result.prefix.includes("coder-workflow"));
  assert.ok(typeof result.stats === "object");
});

test("getCacheAlignment stats object is present", () => {
  const result = getCacheAlignment();

  assert.ok("hits" in result.stats);
  assert.ok("misses" in result.stats);
});
