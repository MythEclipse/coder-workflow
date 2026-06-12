import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  alignCache,
  cleanCCR,
  compress,
  decompress,
  formatCompressedPreview,
  getCacheAlignment,
  getStats,
  printCompressionSummary,
} from "../src/compress.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "compress-test-"));
  const orig = process.cwd();
  process.chdir(dir);
  return orig;
}

function restoreCwd(orig: string, tmp: string): void {
  process.chdir(orig);
  rmSync(tmp, { recursive: true, force: true });
}

const LARGE_JSON_ARRAY = JSON.stringify(
  Array.from({ length: 20 }, (_, i) => ({
    description: `Item ${i}`,
    statusCode: i % 3 === 0 ? "active" : "inactive",
    configuration: { timeout: 5000, retries: 3 },
    message: `This is a verbose message for item number ${i}`,
    reference: `ref-${i.toString().padStart(4, "0")}`,
    flag: i === 0 ? true : false,
    count: i,
  })),
);

// ─── JSON Compression ─────────────────────────────────────────────────────────

test("compress auto-detects JSON array and applies crushArray", () => {
  const result = compress(LARGE_JSON_ARRAY);

  assert.equal(result.contentType, "json");
  assert.ok(result.compressed.length < result.originalSize, "compressed should be smaller");
  assert.ok(result.ratio > 0.15, "ratio should be significant for large array");
  assert.ok(result.hash.length > 0, "hash should be present");
  // crushArray produces _schema / _count / _items
  assert.ok(
    result.compressed.includes("_schema") || result.compressed.includes("k0"),
    "crushArray output should contain schema or shortened keys",
  );
});

test("compress JSON array with 40 items truncates to 30 with _truncated marker", () => {
  const big = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ id: i, value: `item-${i}` })));
  const result = compress(big);
  const parsed = JSON.parse(result.compressed) as Record<string, unknown>;
  assert.equal((parsed._items as unknown[]).length, 30);
  assert.equal(parsed._truncated, 10);
});

test("compress JSON array with fewer than 5 items uses simple stringify", () => {
  const small = JSON.stringify([{ a: 1 }, { a: 2 }]);
  const result = compress(small);
  // No schema extraction for small arrays
  assert.ok(result.compressed.length > 0);
});

test("compress JSON object shortens known keys via KEY_SHORTENINGS", () => {
  const input = JSON.stringify({
    description: "desc value",
    summary: "sum value",
    properties: { x: 1 },
    arguments: ["a"],
    parameters: { p: 1 },
    configuration: { env: "prod" },
    environment: "prod",
    directory: "/path",
    filename: "file.ts",
    extension: ".ts",
    language: "ts",
    statusCode: 200,
    message: "ok",
    response: { data: 1 },
    request: { body: "" },
    previous: "prev",
    current: "cur",
    original: "orig",
    reference: "ref",
  });

  const result = compress(input);
  assert.equal(result.contentType, "json");
  const parsed = JSON.parse(result.compressed) as Record<string, unknown>;

  assert.equal(parsed.desc as string, "desc value");
  assert.equal(parsed.sum as string, "sum value");
  assert.equal((parsed.props as Record<string, unknown>)?.x as number, 1);
  assert.equal((parsed.args as unknown[])?.[0] as string, "a");
  assert.equal((parsed.params as Record<string, unknown>)?.p as number, 1);
  assert.equal((parsed.config as Record<string, unknown>)?.env as string, "prod");
  assert.equal(parsed.env as string, "prod");
  assert.equal(parsed.dir as string, "/path");
  assert.equal(parsed.file as string, "file.ts");
  assert.equal(parsed.ext as string, ".ts");
  assert.equal(parsed.lang as string, "ts");
  assert.equal(parsed.code as number, 200);
  assert.equal(parsed.msg as string, "ok");
  assert.equal((parsed.res as Record<string, unknown>)?.data as number, 1);
  assert.equal((parsed.req as Record<string, unknown>)?.body as string, "");
  assert.equal(parsed.prev as string, "prev");
  assert.equal(parsed.cur as string, "cur");
  assert.equal(parsed.orig as string, "orig");
  assert.equal(parsed.ref as string, "ref");
});

test("compress JSON object strips null, undefined, and empty string values", () => {
  const jsonInput = JSON.stringify({
    keep: "value",
    remove: null,
    skip: undefined,
    empty: "",
    valid: "ok",
  });
  // Note: JSON.stringify drops undefined keys, so we need a raw-string approach
  const raw = `{"keep":"value","remove":null,"empty":"","valid":"ok"}`;
  const result = compress(raw);
  const parsed = JSON.parse(result.compressed) as Record<string, unknown>;
  assert.equal(parsed.keep, "value");
  assert.equal(parsed.valid, "ok");
  // null and empty should be removed
  assert.equal(parsed.remove, undefined);
  assert.equal(parsed.empty, undefined);
});

test("compress JSON object truncates long string values (>200 chars)", () => {
  const long = "x".repeat(500);
  const input = JSON.stringify({ description: long, short: "ok" });
  const result = compress(input);
  const parsed = JSON.parse(result.compressed) as Record<string, unknown>;
  assert.ok(typeof parsed.desc === "string");
  assert.ok((parsed.desc as string).includes("[+"));
  assert.ok((parsed.desc as string).length < 250);
});

// ─── Code Compression ─────────────────────────────────────────────────────────

test("compress code strips line and block comments for typescript", () => {
  const input = `// line comment
const x = 1; /* block comment */
const y = 2;
`;
  const result = compress(input, { filePath: "test.ts" });
  assert.equal(result.contentType, "code");
  assert.ok(!result.compressed.includes("line comment"), "line comment should be stripped");
  assert.ok(!result.compressed.includes("block comment"), "block comment should be stripped");
  assert.ok(result.compressed.includes("const x = 1;"));
  assert.ok(result.compressed.includes("const y = 2;"));
});

test("compress code collapses multiple blank lines", () => {
  const input = `const a = 1;


const b = 2;


const c = 3;
`;
  const result = compress(input, { filePath: "test.ts" });
  // Should have at most 1 blank line between statements
  const blankRuns = result.compressed.match(/\n{3,}/g);
  assert.equal(blankRuns, null, "should not have 3+ consecutive blank lines");
});

test("compress code truncates identifiers longer than 20 chars", () => {
  const input = `const veryLongIdentifierNameExceedingLimit = 42;`;
  const result = compress(input, { filePath: "test.ts" });
  const compressed = result.compressed;
  // The regex matches identifiers >= 21 chars and truncates to first 18 + "..."
  // "veryLongIdentifierNameExceedingLimit" (36 chars) -> "veryLongIdentifier..."
  assert.ok(
    compressed.includes("veryLongIdentifier"),
    "should contain first 18 chars of identifier",
  );
  assert.ok(
    !compressed.includes("veryLongIdentifierNameExceedingLimit"),
    "full identifier should be truncated",
  );
});

test("compress code with python extension strips hash comments", () => {
  const input = `# python comment
def hello():
    return "world"
`;
  const result = compress(input, { filePath: "main.py" });
  assert.equal(result.contentType, "code");
  assert.ok(!result.compressed.includes("python comment"));
  assert.ok(result.compressed.includes("def hello"));
});

test("compress code with no extension falls through to auto-detect", () => {
  // Without filePath, auto-detect treats this as prose
  const input = `function test() { return 1; }`;
  const result = compress(input);
  assert.equal(
    result.contentType,
    "prose",
    "no filePath means auto-detect, which defaults to prose",
  );
});

test("compress code with unknown extension still processes as code type if explicitly set", () => {
  const input = `fn main() { println!("hello"); }`;
  const result = compress(input, { filePath: "main.unknown", contentType: "code" });
  assert.equal(result.contentType, "code");
  // unknown extension = no language detection, no comment stripping, but still truncation applies
  assert.ok(result.compressed.includes("fn main()"));
});

// ─── Prose Compression ────────────────────────────────────────────────────────

test("compress prose with >500 lines truncates to head 250 and tail 250", () => {
  const lines = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}`);
  const input = lines.join("\n");
  const result = compress(input);

  assert.equal(result.contentType, "prose");
  assert.equal(result.truncated, true);
  assert.ok(result.compressed.includes("Line 1"));
  assert.ok(result.compressed.includes("Line 250"));
  assert.ok(
    result.compressed.includes("[100 lines collapsed]") ||
      result.compressed.includes("lines collapsed"),
    "should show collapsed lines count",
  );
  assert.ok(result.compressed.includes("Line 351"));
  assert.ok(result.compressed.includes("Line 600"));
});

test("compress prose with <=500 lines does not truncate lines", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `Line ${i + 1}`);
  const input = lines.join("\n");
  const result = compress(input);

  assert.equal(result.contentType, "prose");
  assert.equal(result.truncated, false);
  assert.ok(result.compressed.includes("Line 400"));
  assert.ok(!result.compressed.includes("lines collapsed"));
});

test("compress prose empty string returns ratio 0", () => {
  const result = compress("");
  assert.equal(result.originalSize, 0);
  assert.equal(result.ratio, 0);
  assert.equal(result.ccrId, undefined);
});

// ─── Content Type Detection ───────────────────────────────────────────────────

test("compress with explicit contentType bypasses auto-detection", () => {
  const json = '{"key": "value"}';
  const asProse = compress(json, { contentType: "prose" });
  assert.equal(asProse.contentType, "prose");
  // Should not be crushed as JSON
});

test("compress auto-detection tries JSON first, then defaults to prose", () => {
  const result = compress("plain text without any json structure");
  assert.equal(result.contentType, "prose");
});

// ─── Decompress Round-trip ────────────────────────────────────────────────────

test("decompress round-trip stores and retrieves original content", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    compress(LARGE_JSON_ARRAY);
    // The compress function stored the CCR entry; find it via the ccr directory
    const ccrDir = join(tmpDir, ".claude", "ccr");
    assert.ok(existsSync(ccrDir), "CCR directory should exist");

    // Run compress again to get the ccrId
    const result = compress(LARGE_JSON_ARRAY);
    assert.ok(result.ccrId, "Large compressible content should produce a CCR ID");

    const decompressed = decompress(result.ccrId!);
    assert.ok(decompressed !== null, "should find decompressed entry");
    assert.equal(decompressed!.original, LARGE_JSON_ARRAY);
    assert.equal(decompressed!.hash, result.hash);
    assert.equal(decompressed!.contentType, "json");
    assert.ok(decompressed!.timestamp.length > 0, "timestamp should be present");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("decompress with ccrId containing only hash prefix matches existing entries", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const result = compress(LARGE_JSON_ARRAY);
    assert.ok(result.ccrId);

    // Use just the hash portion (before the dash) to test filename matching
    const hashOnly = result.hash;
    const decompressed = decompress(hashOnly);
    assert.ok(decompressed !== null, "should match by hash prefix");
    assert.equal(decompressed!.original, LARGE_JSON_ARRAY);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("decompress with non-existent ID returns null", () => {
  const result = decompress("non-existent-ccr-id");
  assert.equal(result, null);
});

test("decompress respects ccr directory absence", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    // No .claude/ccr exists yet — decompress should return null gracefully
    const result = decompress("anything");
    assert.equal(result, null);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── Stats and Cleanup ────────────────────────────────────────────────────────

test("getStats returns expected shape", () => {
  const stats = getStats();

  assert.ok(typeof stats.totalOriginalBytes === "number");
  assert.ok(typeof stats.totalCompressedBytes === "number");
  assert.ok(typeof stats.averageRatio === "number");
  assert.ok(typeof stats.contentTypes === "object");
  assert.ok(typeof stats.ccrCount === "number");
});

test("cleanCCR does not throw and returns a number", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    // First store something
    compress(LARGE_JSON_ARRAY);
    const purged = cleanCCR(0);
    assert.equal(typeof purged, "number");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("cleanCCR on empty directory returns 0", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const purged = cleanCCR(24);
    assert.equal(purged, 0);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── CacheAligner (from compress.ts) ─────────────────────────────────────────

test("alignCache produces aligned content with default prefix", () => {
  const result = alignCache("hello world");

  assert.ok(result.aligned.startsWith("[PROJECT] coder-workflow |"));
  assert.ok(result.aligned.endsWith("hello world"));
  assert.equal(result.cacheable, true);
  assert.ok(result.prefixHash.length > 0);
});

test("alignCache includes task type when provided", () => {
  const result = alignCache("test", { taskType: "implement" });

  assert.ok(result.aligned.includes("task:implement"));
});

test("alignCache includes mode when provided", () => {
  const result = alignCache("test", { mode: "strict" });

  assert.ok(result.aligned.includes("mode:strict"));
});

test("alignCache with project name customizes prefix", () => {
  const result = alignCache("test", { projectName: "my-project" });

  assert.ok(result.aligned.includes("my-project"));
});

test("alignCache handles empty content", () => {
  const result = alignCache("");

  assert.ok(result.aligned.endsWith(""));
  assert.equal(result.cacheable, true);
});

test("alignCache with all options", () => {
  const result = alignCache("content", {
    taskType: "refactor",
    mode: "safe",
    projectName: "alpha",
  });

  assert.ok(result.aligned.includes("[PROJECT] coder-workflow |"));
  assert.ok(result.aligned.includes("alpha"));
  assert.ok(result.aligned.includes("task:refactor"));
  assert.ok(result.aligned.includes("mode:safe"));
  assert.ok(result.aligned.endsWith("content"));
});

test("getCacheAlignment returns prefix and stats", () => {
  const result = getCacheAlignment();

  assert.ok(result.prefix.startsWith("[PROJECT]"));
  assert.ok(typeof result.stats === "object");
  assert.ok(typeof result.stats.hits === "number");
  assert.ok(typeof result.stats.misses === "number");
});

// ─── Formatting Utilities ────────────────────────────────────────────────────

test("printCompressionSummary produces formatted output", () => {
  const stats = getStats();
  const output = printCompressionSummary(stats);

  assert.ok(output.includes("CCR Statistics"));
  assert.ok(output.includes(`CCR Entries:  ${stats.ccrCount}`));
  assert.ok(output.includes("Total Stored:"));
});

test("formatCompressedPreview includes compression details", () => {
  const result = compress(LARGE_JSON_ARRAY);
  const preview = formatCompressedPreview(result);

  assert.ok(preview.includes("[CCR]"));
  assert.ok(preview.includes("JSON"));
  assert.ok(preview.includes("% compressed"));
  assert.ok(preview.includes(result.hash));
  assert.ok(preview.includes("bytes"));
  assert.ok(preview.includes(result.compressed));
});

test("formatCompressedPreview includes restore hint when ccrId exists", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const result = compress(LARGE_JSON_ARRAY);
    assert.ok(result.ccrId);
    const preview = formatCompressedPreview(result);
    assert.ok(preview.includes("decompress_content"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("formatCompressedPreview omits restore hint when no ccrId", () => {
  const result = compress("small");
  assert.equal(result.ccrId, undefined);
  const preview = formatCompressedPreview(result);
  assert.ok(!preview.includes("decompress_content"));
});

test("formatCompressedPreview for prose shows PROSE tag", () => {
  const result = compress("hello world");
  const preview = formatCompressedPreview(result);
  assert.ok(preview.includes("PROSE"));
});
