import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { summarizeGraphForBudget } from "../src/graph/summarize.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-mcp-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

async function withClient<T>(root: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "codegraph-mcp-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "mcp-server.js")],
    cwd: root,
  });

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

interface TextToolResult {
  content: Array<{ type: string; text: string }>;
}

interface QualityGateOutput {
  failedThreshold: string;
  wouldFail: boolean;
  failingIssues: Array<{ severity: string }>;
  issues?: Array<{ severity: string }>;
  summary?: unknown;
  recommendations?: unknown;
}

function parseToolJson(result: unknown): QualityGateOutput {
  if (isTextToolResult(result)) {
    const item = result.content[0];
    if (item?.type === "text") {
      return JSON.parse(item.text) as QualityGateOutput;
    }
  }
  throw new Error("Invalid tool result format");
}

function isTextToolResult(result: unknown): result is TextToolResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray(result.content)
  );
}

test("MCP lists quality_gate and analyze_quality tools with correct schemas", async () => {
  const root = fixture({
    "src/app.ts": `export function app() { return "ok"; }`,
  });

  await withClient(root, async (client) => {
    const tools = await client.listTools();

    const qualityGate = tools.tools.find((t) => t.name === "quality_gate");
    assert.ok(qualityGate, "quality_gate tool should be listed");
    assert.deepEqual(
      qualityGate.inputSchema.required,
      ["threshold"],
      "quality_gate should require threshold",
    );
    assert.deepEqual(
      qualityGate.inputSchema.properties?.threshold,
      { type: "string", enum: ["high", "medium", "low"] },
      "quality_gate threshold should be high|medium|low",
    );
    assert.deepEqual(
      qualityGate.inputSchema.properties?.includeReport,
      { type: "boolean" },
      "quality_gate should have includeReport boolean",
    );

    const analyzeQuality = tools.tools.find((t) => t.name === "analyze_quality");
    assert.ok(analyzeQuality, "analyze_quality tool should be listed");
    assert.deepEqual(
      analyzeQuality.inputSchema.properties?.failOn,
      { type: "string", enum: ["high", "medium", "low"] },
      "analyze_quality failOn should be high|medium|low",
    );
  });
});

test("quality_gate with threshold high on unresolved import returns gate fields", async () => {
  const root = fixture({
    "src/app.ts": `import { missingTarget } from "./missing";
export function app() {
  return missingTarget();
}`,
  });

  await withClient(root, async (client) => {
    await client.callTool({ name: "scan_codebase", arguments: {} });

    const result = await client.callTool({
      name: "quality_gate",
      arguments: { threshold: "high" },
    });
    const output = parseToolJson(result);

    assert.equal(output.failedThreshold, "high", "output should have failedThreshold = high");
    assert.equal(output.wouldFail, true, "output should have wouldFail = true");
    assert.ok(Array.isArray(output.failingIssues), "output should have failingIssues array");
    assert.ok(output.failingIssues.length > 0, "failingIssues should not be empty");
    assert.equal(output.summary, undefined, "output should not have summary field");
    assert.equal(output.recommendations, undefined, "output should not have recommendations field");
  });
});

test("quality_gate with includeReport true includes full report fields", async () => {
  const root = fixture({
    "src/app.ts": `import { missingTarget } from "./missing";
export function app() {
  return missingTarget();
}`,
  });

  await withClient(root, async (client) => {
    await client.callTool({ name: "scan_codebase", arguments: {} });

    const result = await client.callTool({
      name: "quality_gate",
      arguments: { threshold: "high", includeReport: true },
    });
    const output = parseToolJson(result);

    assert.equal(output.failedThreshold, "high", "output should have failedThreshold");
    assert.equal(output.wouldFail, true, "output should have wouldFail");
    assert.ok(Array.isArray(output.failingIssues), "output should have failingIssues");
    assert.ok(
      output.summary !== undefined,
      "output should include summary when includeReport true",
    );
    assert.ok(
      output.recommendations !== undefined,
      "output should include recommendations when includeReport true",
    );

    const highIssues = output.issues?.filter((issue) => issue.severity === "high") || [];
    assert.deepEqual(
      output.failingIssues,
      highIssues,
      "failingIssues should equal high severity issues",
    );
  });
});

test("analyze_quality with failOn high returns gate and report fields", async () => {
  const root = fixture({
    "src/app.ts": `import { missingTarget } from "./missing";
export function app() {
  return missingTarget();
}`,
  });

  await withClient(root, async (client) => {
    await client.callTool({ name: "scan_codebase", arguments: {} });

    const result = await client.callTool({
      name: "analyze_quality",
      arguments: { failOn: "high" },
    });
    const output = parseToolJson(result);

    assert.equal(output.failedThreshold, "high", "output should have failedThreshold");
    assert.equal(output.wouldFail, true, "output should have wouldFail");
    assert.ok(Array.isArray(output.failingIssues), "output should have failingIssues");
    assert.ok(output.summary !== undefined, "output should have summary from report");
    assert.ok(
      output.recommendations !== undefined,
      "output should have recommendations from report",
    );
  });
});

test("quality_gate rejects invalid threshold with clear error", async () => {
  const root = fixture({
    "src/app.ts": `export function app() { return "ok"; }`,
  });

  await withClient(root, async (client) => {
    await client.callTool({ name: "scan_codebase", arguments: {} });

    const result = await client.callTool({ name: "quality_gate", arguments: { threshold: "severe" } });
    assert.equal(result.isError, true, "should return isError true for invalid threshold");
    const textContent = (result as any).content[0] as { type: "text"; text: string };
    assert.match(
      textContent.text,
      /Invalid threshold\. Use high, medium, or low\./,
      "error should match expected message",
    );
  });
});

test("analyze_quality reports ambiguous-call issues for low-confidence edges", async () => {
  const root = fixture({
    "src/app.ts": `
      export class UserRepo { save() { return "user"; } }
      export class AuditRepo { save() { return "audit"; } }
      export function run(repo: UserRepo) { return repo.save(); }
    `,
  });

  await withClient(root, async (client) => {
    await client.callTool({ name: "scan_codebase", arguments: {} });

    const result = await client.callTool({
      name: "analyze_quality",
      arguments: { failOn: "medium" },
    });
    const output = parseToolJson(result);

    assert.ok(
      output.issues?.some((issue) => issue.severity === "medium"),
      "should have medium severity issues",
    );
    assert.ok(output.summary !== undefined, "output should have summary from report");
  });
});

test("summarizeGraphForBudget returns bounded nodes with omitted counts", () => {
  const graph = {
    version: "0.1.0" as const,
    generatedAt: new Date().toISOString(),
    root: "/test",
    nodes: Array.from({ length: 20 }, (_, index) => ({
      id: `file:${index}`,
      type: "file" as const,
      name: `file${index}.ts`,
      path: `file${index}.ts`,
    })),
    edges: Array.from({ length: 19 }, (_, index) => ({
      id: `e:${index}`,
      type: "depends-on" as const,
      source: `file:${index}`,
      target: `file:${index + 1}`,
    })),
    metadata: {
      filesScanned: 20,
      nodesCount: 20,
      edgesCount: 19,
      languages: ["typescript"],
      ignoredPaths: [],
      nodeTypes: {},
      edgeTypes: {},
      relationshipCoverage: 1,
      qualityScore: 1,
    },
  };

  const summary = summarizeGraphForBudget(graph, { maxNodes: 5, maxEdges: 5 });
  assert.equal(summary.nodes.length, 5);
  assert.equal(summary.edges.length, 5);
  assert.equal(summary.omitted.nodes, 15);
  assert.equal(summary.omitted.edges, 14);
});

test("MCP summarize_graph tool returns bounded graph data", async () => {
  const root = fixture({
    "src/a.ts": "export function a() {}",
    "src/b.ts": "import { a } from './a'; export function b() { a(); }",
    "src/c.ts": "import { b } from './b'; export function c() { b(); }",
  });

  await withClient(root, async (client) => {
    await client.callTool({ name: "scan_codebase", arguments: {} });

    const result = await client.callTool({
      name: "summarize_graph",
      arguments: { maxNodes: 5, maxEdges: 5 },
    });

    if (isTextToolResult(result)) {
      const item = result.content[0];
      if (item?.type === "text") {
        const summary = JSON.parse(item.text);
        assert.equal(typeof summary.omitted.nodes, "number");
        assert.equal(typeof summary.omitted.edges, "number");
        assert.ok(Array.isArray(summary.nodes));
        assert.ok(Array.isArray(summary.edges));
        assert.ok(Array.isArray(summary.hotspots));
      }
    }
  });
});
