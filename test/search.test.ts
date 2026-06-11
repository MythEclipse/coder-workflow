import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rankHybridSearchResults } from "../src/search/semantic.js";
import { searchCodebase } from "../src/search.js";
import type { CodeGraphSettings } from "../src/types.js";

const settings: CodeGraphSettings = {
  languages: ["javascript", "typescript", "python", "go", "rust", "java"],
  ignorePaths: ["node_modules", ".git", "dist", "build", ".next", "vendor", ".codegraph/cache"],
  updateOnStop: true,
  updateOnEdit: false,
  commitGraphJson: false,
  maxDepth: 4,
  uiPort: 3737,
  exports: ["json", "mermaid", "dot", "markdown"],
};

function fixture(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-search-test-"));
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

interface TextToolResult {
  content: Array<{ type: string; text: string }>;
}

function parseToolJson(result: unknown): unknown {
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as TextToolResult).content)
  ) {
    const item = (result as TextToolResult).content[0];
    if (item?.type === "text") return JSON.parse(item.text) as unknown;
  }
  throw new Error("Invalid tool result format");
}

test("searchCodebase returns structured literal matches with context and stats", () => {
  const root = fixture({
    "src/app.ts": `const first = "alpha";
const target = "Needle";
const last = "omega";
`,
  });

  const output = searchCodebase(root, settings, { pattern: "needle", contextLines: 1 });

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0]?.file, "src/app.ts");
  assert.equal(output.results[0]?.line, 2);
  assert.equal(output.results[0]?.column, 17);
  assert.equal(output.results[0]?.text, `const target = "Needle";`);
  assert.deepEqual(output.results[0]?.contextBefore, [`const first = "alpha";`]);
  assert.deepEqual(output.results[0]?.contextAfter, [`const last = "omega";`]);
  assert.equal(output.results[0]?.fileSizeBytes, 70);
  assert.equal(output.results[0]?.matchLength, 6);
  assert.equal(output.stats.filesConsidered, 1);
  assert.equal(output.stats.filesSearched, 1);
  assert.equal(output.stats.totalMatches, 1);
  assert.equal(output.stats.truncated, false);
});

test("searchCodebase supports regex and maxResults truncation", () => {
  const root = fixture({
    "src/app.ts": `export function firstThing() { return 1; }
export function secondThing() { return 2; }
`,
  });

  const output = searchCodebase(root, settings, {
    pattern: "function\\s+\\w+Thing",
    maxResults: 1,
  });

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0]?.line, 1);
  assert.equal(output.stats.totalMatches, 1);
  assert.equal(output.stats.truncated, true);
});

test("searchCodebase validates invalid regex and numeric bounds", () => {
  const root = fixture({
    "src/app.ts": `const value = "Needle";`,
  });

  assert.throws(
    () => searchCodebase(root, settings, { pattern: "[invalid" }),
    /Invalid regex pattern:/,
  );
  assert.throws(
    () => searchCodebase(root, settings, { pattern: "Needle", maxResults: 0 }),
    /maxResults must be an integer between 1 and 10000\./,
  );
  assert.throws(
    () => searchCodebase(root, settings, { pattern: "Needle", contextLines: 101 }),
    /contextLines must be an integer between 0 and 100\./,
  );
});

test("searchCodebase honors case sensitivity", () => {
  const root = fixture({
    "src/app.ts": `const value = "Needle";`,
  });

  assert.equal(searchCodebase(root, settings, { pattern: "needle" }).results.length, 1);
  assert.equal(
    searchCodebase(root, settings, { pattern: "needle", caseSensitive: true }).results.length,
    0,
  );
});

test("searchCodebase respects ignored paths", () => {
  const root = fixture({
    "src/app.ts": `const value = "visible";`,
    "dist/app.ts": `const value = "visible";`,
  });

  const output = searchCodebase(root, settings, { pattern: "visible" });

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0]?.file, "src/app.ts");
});

test("searchCodebase supports include and exclude globs", () => {
  const root = fixture({
    "src/app.ts": `const value = "needle";`,
    "src/app.test.ts": `const value = "needle";`,
    "test/app.test.ts": `const value = "needle";`,
  });

  const output = searchCodebase(root, settings, {
    pattern: "needle",
    include: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
  });

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0]?.file, "src/app.ts");
  assert.equal(output.stats.filesSkipped, 2);
});

test("searchCodebase skips binary and oversized files", () => {
  const root = fixture({
    "src/app.ts": `const value = "needle";`,
    "src/binary.ts": Buffer.from([0, 1, 2, 3, 4]),
    "src/large.ts": `const value = "needle";\n`.repeat(20),
  });

  const output = searchCodebase(root, settings, { pattern: "needle", maxFileSizeBytes: 30 });

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0]?.file, "src/app.ts");
  assert.equal(output.stats.binaryFilesSkipped, 1);
  assert.equal(output.stats.oversizedFilesSkipped, 1);
});

test("searchCodebase records read errors", () => {
  const root = fixture({
    "src/app.ts": `const value = "needle";`,
    "src/blocked.ts": `const value = "needle";`,
  });
  chmodSync(join(root, "src/blocked.ts"), 0o000);

  try {
    const output = searchCodebase(root, settings, { pattern: "needle" });

    assert.equal(output.results.length, 1);
    assert.equal(output.stats.readErrors.length, 1);
    assert.equal(output.stats.readErrors[0]?.file, "src/blocked.ts");
  } finally {
    chmodSync(join(root, "src/blocked.ts"), 0o644);
  }
});

test("rankHybridSearchResults combines lexical and graph scores deterministically", () => {
  const candidates = [
    { id: "a", lexicalScore: 0.8, graphScore: 0.5 },
    { id: "b", lexicalScore: 0.6, graphScore: 0.9 },
    { id: "c", lexicalScore: 0.7, graphScore: 0.7 },
  ];

  const weights = { lexicalWeight: 0.6, graphWeight: 0.4 };
  const ranked = rankHybridSearchResults(candidates, weights);

  // Expected scores: a = 0.6*0.8 + 0.4*0.5 = 0.68, b = 0.6*0.6 + 0.4*0.9 = 0.72, c = 0.6*0.7 + 0.4*0.7 = 0.7
  assert.equal(ranked[0]?.id, "b"); // 0.72
  assert.equal(ranked[1]?.id, "c"); // 0.7
  assert.equal(ranked[2]?.id, "a"); // 0.68
});

test("rankHybridSearchResults handles semantic scores when provided", () => {
  const candidates = [
    { id: "x", lexicalScore: 0.5, graphScore: 0.5, semanticScore: 0.9 },
    { id: "y", lexicalScore: 0.9, graphScore: 0.5, semanticScore: 0.1 },
  ];

  const weights = { lexicalWeight: 0.3, graphWeight: 0.3, semanticWeight: 0.4 };
  const ranked = rankHybridSearchResults(candidates, weights);

  // Expected: x = 0.3*0.5 + 0.3*0.5 + 0.4*0.9 = 0.15 + 0.15 + 0.36 = 0.66
  //           y = 0.3*0.9 + 0.3*0.5 + 0.4*0.1 = 0.27 + 0.15 + 0.04 = 0.46
  assert.equal(ranked[0]?.id, "x");
  assert.equal(ranked[1]?.id, "y");
});

test("rankHybridSearchResults sorts by id when scores are equal", () => {
  const candidates = [
    { id: "zebra", lexicalScore: 0.5, graphScore: 0.5 },
    { id: "apple", lexicalScore: 0.5, graphScore: 0.5 },
  ];

  const weights = { lexicalWeight: 1, graphWeight: 0 };
  const ranked = rankHybridSearchResults(candidates, weights);

  assert.equal(ranked[0]?.id, "apple");
  assert.equal(ranked[1]?.id, "zebra");
});

test("rankHybridSearchResults throws on zero total weight", () => {
  const candidates = [{ id: "a", lexicalScore: 0.5, graphScore: 0.5 }];
  const weights = { lexicalWeight: 0, graphWeight: 0 };

  assert.throws(
    () => rankHybridSearchResults(candidates, weights),
    /Total weight must be positive/,
  );
});

test("searchCodebase returns results with lexical and graph scores", () => {
  const root = fixture({
    "src/app.ts": `const first = "alpha";
const target = "Needle";
const last = "omega";
`,
  });

  const output = searchCodebase(root, settings, { pattern: "needle", contextLines: 1 });

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0]?.lexicalScore, 1.0);
  assert.equal(output.results[0]?.graphScore, 0);
});

test("searchCodebase applies hybrid ranking to multiple results", () => {
  const root = fixture({
    "src/app.ts": `export function firstNeedle() { return 1; }
export function secondNeedle() { return 2; }
export function thirdNeedle() { return 3; }
`,
  });

  const output = searchCodebase(root, settings, { pattern: "Needle", maxResults: 10 });

  assert.equal(output.results.length, 3);
  // All results should have scores
  for (const result of output.results) {
    assert.equal(typeof result.lexicalScore, "number");
    assert.equal(typeof result.graphScore, "number");
  }
});

test("search CLI returns structured JSON results", () => {
  const root = fixture({
    "src/app.ts": `export function cliNeedle() { return "ok"; }`,
  });

  const result = runCli(root, ["search", "cliNeedle", "--case-sensitive"]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].file, "src/app.ts");
  assert.equal(output.results[0].column, 17);
  assert.equal(output.stats.totalMatches, 1);
});

test("search CLI validates missing pattern, invalid regex, numbers, and unknown options", () => {
  const root = fixture({
    "src/app.ts": `export function cliNeedle() { return "ok"; }`,
  });

  const missing = runCli(root, ["search"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Search pattern is required\./);

  const invalidRegex = runCli(root, ["search", "[invalid"]);
  assert.equal(invalidRegex.status, 1);
  assert.match(invalidRegex.stderr, /Invalid regex pattern:/);

  const literal = runCli(root, ["search", "needle", "--literal"]);
  assert.equal(literal.status, 0);

  const invalidNumber = runCli(root, ["search", "needle", "--max-results", "nope"]);
  assert.equal(invalidNumber.status, 1);
  assert.match(invalidNumber.stderr, /--max-results requires a finite number\./);

  const unknown = runCli(root, ["search", "needle", "--bogus"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown search option: --bogus/);
});

test("MCP exposes and runs production search_code", async () => {
  const root = fixture({
    "src/app.ts": `export function mcpNeedle() { return "ok"; }`,
    "src/app.test.ts": `export function mcpNeedle() { return "test"; }`,
  });
  const client = new Client({ name: "codegraph-search-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "mcp-server.js")],
    cwd: root,
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const searchTool = tools.tools.find((tool) => tool.name === "search_code");
    assert.ok(searchTool);
    const includeProp = searchTool.inputSchema.properties?.include as
      | Record<string, unknown>
      | undefined;
    assert.equal((includeProp as Record<string, unknown>)?.type, "array");
    const itemsProp = (includeProp as Record<string, unknown>)?.items as Record<string, unknown>;
    assert.equal(itemsProp?.type, "string");

    const result = await client.callTool({
      name: "search_code",
      arguments: {
        pattern: "mcpNeedle",
        caseSensitive: true,
        include: ["src/**/*.ts"],
        exclude: ["**/*.test.ts"],
      },
    });
    const output = parseToolJson(result) as { results: Array<{ file: string; line: number }> };

    assert.equal(output.results.length, 1);
    assert.equal(output.results[0]?.file, "src/app.ts");
    assert.equal(output.results[0]?.line, 1);
  } finally {
    await client.close();
  }
});

test("MCP rejects invalid search_code input", async () => {
  const root = fixture({
    "src/app.ts": `export function mcpNeedle() { return "ok"; }`,
  });
  const client = new Client({ name: "codegraph-search-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "mcp-server.js")],
    cwd: root,
  });

  await client.connect(transport);
  try {
    await assert.rejects(
      client.callTool({
        name: "search_code",
        arguments: { pattern: "needle", maxResults: "many" },
      }),
      /Search numeric options must be finite numbers\./,
    );
  } finally {
    await client.close();
  }
});

test("searchCodebase supports multi-pattern OR'd search with dedup", () => {
  const root = fixture({
    "src/app.ts": `const alpha = 1;
const beta = 2;
const gamma = 3;
`,
  });

  const output = searchCodebase(root, settings, {
    pattern: "alpha",
    patterns: ["beta", "gamma"],
    regex: false,
  });

  assert.equal(output.results.length, 3);
  const files = output.results.map((r) => r.file);
  assert.equal(new Set(files).size, 1); // all same file
  assert.equal(output.stats.totalMatches, 3);
});

test("searchCodebase regex default with literal word works", () => {
  const root = fixture({
    "src/app.ts": `const value = "Needle";`,
  });

  // plain word is a valid regex, should match
  const output = searchCodebase(root, settings, { pattern: "Needle" });
  assert.equal(output.results.length, 1);
});

test("searchCodebase defaults to regex with metacharacters", () => {
  const root = fixture({
    "src/app.ts": `function getData(): string { return "ok"; }`,
  });

  // regex metacharacters enabled by default
  const output = searchCodebase(root, settings, {
    pattern: "function\\s+\\w+\\(\\):\\s+string",
  });
  assert.equal(output.results.length, 1);
});

test("MCP search_code accepts multi-pattern patterns array", async () => {
  const root = fixture({
    "src/app.ts": `export function alpha() { return 1; }
export function beta() { return 2; }
export function gamma() { return 3; }
`,
  });
  const client = new Client({ name: "codegraph-search-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "mcp-server.js")],
    cwd: root,
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "search_code",
      arguments: {
        pattern: "alpha",
        patterns: ["beta", "gamma"],
        regex: false,
      },
    });
    const output = parseToolJson(result) as { results: Array<{ file: string }> };
    assert.equal(output.results.length, 3);
  } finally {
    await client.close();
  }
});
