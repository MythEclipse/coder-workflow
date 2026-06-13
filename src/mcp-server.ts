#!/usr/bin/env node
/**
 * Coder Workflow MCP Server — 34 tools across 7 categories
 */

import { cwd } from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import * as gitCode from "./mcp/tools/git-code.js";
import * as projectTeam from "./mcp/tools/project-team.js";
import * as testing from "./mcp/tools/testing.js";
import * as runtime from "./mcp/tools/runtime.js";
import * as security from "./mcp/tools/security.js";
import * as aiNative from "./mcp/tools/ai-native.js";
import * as devops from "./mcp/tools/devops.js";

interface ToolModuleEntry {
  name: string;
  tool: {
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>, root: string) => Promise<unknown>;
  };
}

const modules = [gitCode, projectTeam, testing, runtime, security, aiNative, devops];

const allTools: Array<{
  name: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  description: string;
  inputSchema: Record<string, unknown>;
}> = [];

for (const mod of modules) {
  for (const key of Object.keys(mod)) {
    const entry = (mod as unknown as Record<string, ToolModuleEntry>)[key];
    if (entry?.name && entry.tool) {
      const root = cwd();
      allTools.push({
        name: entry.name,
        description: entry.tool.description,
        inputSchema: entry.tool.inputSchema,
        handler: async (args) => entry.tool.handler(args, root),
      });
    }
  }
}

const server = new Server(
  { name: "coder-workflow-mcp", version: "0.3.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};
  const found = allTools.find((t) => t.name === name);
  if (!found) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await found.handler(args as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP Server fatal:", err);
  process.exit(1);
});
