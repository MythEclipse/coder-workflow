import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-batch-cli-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

function runCli(root: string, args: string[], input?: string) {
  return spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], {
    cwd: root,
    input,
    encoding: "utf8",
  });
}

test("batch-read CLI accepts inline JSON array", () => {
  const root = fixture({ "src/a.ts": "line 1\nline 2" });

  const result = runCli(root, [
    "batch-read",
    JSON.stringify([{ filePath: "src/a.ts", startLine: 2, endLine: 2 }]),
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.succeeded, 1);
  assert.equal(output.results[0].result, "line 2");
});

test("batch-search CLI accepts --file object input", () => {
  const root = fixture({
    "src/app.ts": "const cliBatchNeedle = true;",
    "batch.json": JSON.stringify({
      items: [{ pattern: "cliBatchNeedle", caseSensitive: true }],
      concurrency: 2,
    }),
  });

  const result = runCli(root, ["batch-search", "--file", "batch.json"]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.concurrency, 2);
  assert.equal(output.succeeded, 1);
  assert.equal(output.results[0].result.results.length, 1);
});

test("batch-tasks CLI accepts stdin", () => {
  const root = fixture({ "src/app.ts": "export function app() { return 1; }" });
  const scan = runCli(root, ["scan"]);
  assert.equal(scan.status, 0);

  const result = runCli(
    root,
    ["batch-tasks", "-"],
    JSON.stringify([{ type: "query_graph", input: { query: "app" } }]),
  );

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.succeeded, 1);
  assert.ok(output.results[0].result.nodes.length > 0);
});

test("batch CLI rejects invalid JSON", () => {
  const root = fixture({ "src/app.ts": "export function app() { return 1; }" });

  const result = runCli(root, ["batch-read", "not-json"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON batch input:/);
});
