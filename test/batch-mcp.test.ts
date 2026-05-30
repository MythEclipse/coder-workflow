import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-batch-mcp-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

async function withClient<T>(root: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "codegraph-batch-mcp-test", version: "0.1.0" });
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

interface ParsedBatchToolResult {
  concurrency: number;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    ok: boolean;
    result?: unknown;
    error?: string;
  }>;
}

function parseToolJson(result: unknown): ParsedBatchToolResult {
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as TextToolResult).content)
  ) {
    const item = (result as TextToolResult).content[0];
    if (!item) throw new Error("Tool result content is empty");
    if (item.type === "text") return JSON.parse(item.text);
  }
  throw new Error("Invalid tool result format");
}

test("MCP lists batch tools", async () => {
  const root = fixture({ "src/app.ts": "export function app() { return 1; }" });

  await withClient(root, async (client) => {
    const tools = await client.listTools();
    for (const name of [
      "batch_read_files",
      "batch_search_code",
      "batch_query_graph",
      "batch_tasks",
    ]) {
      const tool = tools.tools.find((item) => item.name === name);
      assert.ok(tool, `${name} should be listed`);
      assert.deepEqual(tool.inputSchema.properties?.concurrency, { type: "number" });
    }
  });
});

test("MCP batch_read_files returns partial success envelope", async () => {
  const root = fixture({ "src/app.ts": "line 1\nline 2" });

  await withClient(root, async (client) => {
    const result = await client.callTool({
      name: "batch_read_files",
      arguments: {
        concurrency: 2,
        items: [
          { filePath: "src/app.ts", startLine: 2, endLine: 2 },
          { filePath: "src/missing.ts" },
        ],
      },
    });
    const output = parseToolJson(result);

    assert.equal(output.concurrency, 2);
    assert.equal(output.total, 2);
    assert.equal(output.succeeded, 1);
    assert.equal(output.failed, 1);
    assert.equal(output.results[0].result, "line 2");
    assert.equal(output.results[1].ok, false);
  });
});

test("MCP batch_tasks mixes read search query and unsupported failures", async () => {
  const root = fixture({
    "src/app.ts": "export function app() { return 1; }\nconst mcpBatchNeedle = true;",
  });

  await withClient(root, async (client) => {
    await client.callTool({ name: "scan_codebase", arguments: {} });

    const result = await client.callTool({
      name: "batch_tasks",
      arguments: {
        tasks: [
          { type: "read_file", input: { filePath: "src/app.ts", startLine: 1, endLine: 1 } },
          { type: "search_code", input: { pattern: "mcpBatchNeedle", caseSensitive: true } },
          { type: "query_graph", input: { query: "app" } },
          { type: "export_graph", input: {} },
        ],
      },
    });
    const output = parseToolJson(result);

    assert.equal(output.total, 4);
    assert.equal(output.succeeded, 3);
    assert.equal(output.failed, 1);
    assert.match(output.results[3].error ?? "", /Unsupported batch task type: export_graph/);
  });
});
