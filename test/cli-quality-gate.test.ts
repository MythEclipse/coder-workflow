import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-cli-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

function runCli(root: string, args: string[]) {
  return spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("quality command exits non-zero when fail-on threshold is met", () => {
  const root = fixture({
    "src/app.ts": `import { missingTarget } from "./missing";
export function app() {
  return missingTarget();
}
`,
  });

  assert.equal(runCli(root, ["scan"]).status, 0);
  const result = runCli(root, ["quality", "--fail-on", "high"]);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.failedThreshold, "high");
  assert.equal(output.wouldFail, true);
});

test("quality command exits with clean error for invalid fail-on threshold", () => {
  const root = fixture({
    "src/app.ts": `export function app() {
  return "ok";
}
`,
  });

  assert.equal(runCli(root, ["scan"]).status, 0);
  const result = runCli(root, ["quality", "--fail-on", "severe"]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Invalid --fail-on threshold\. Use high, medium, or low\./);
  assert.equal(result.stderr.includes("Error:"), false);
});

test("quality command exits zero when fail-on threshold is not met", () => {
  const root = fixture({
    "src/app.ts": `export function app() {
  return "ok";
}
`,
    "src/other.ts": `export function other() {
  return "ok";
}
`,
    "src/third.ts": `export function third() {
  return "ok";
}
`,
  });

  assert.equal(runCli(root, ["scan"]).status, 0);
  const result = runCli(root, ["quality", "--fail-on", "high"]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.failedThreshold, "high");
  assert.equal(output.wouldFail, false);
});
