#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { QualityGateThreshold } from "./analysis.js";
import {
  analyzeGraphQuality,
  analyzeImpact,
  evaluateQualityGate,
  findCycles,
  findOrphans,
  queryGraph,
  summarizeArchitecture,
} from "./analysis.js";
import { startDashboard } from "./dashboard.js";
import { exportGraph } from "./exporters.js";
import { diffGraphs, formatGraphDiff } from "./git-diff.js";
import { graphExists, readGraph, scanCodebase, writeGraph } from "./graph.js";
import { searchCodebase } from "./search.js";
import { loadSettings } from "./settings.js";
import { openGraphUi } from "./ui.js";
import {
  compress,
  decompress,
  getStats as getCompressionStats,
  cleanCCR,
  alignCache,
  getCacheAlignment,
} from "./compress.js";
import {
  logFailure,
  getFailures,
  analyzeFailures,
  applyCorrections,
  getLearnReport,
  resolveFailure,
  matchCorrection,
} from "./learn.js";
import {
  storeMemory,
  queryMemory,
  getMemoryStats,
  exportToMarkdown as exportMemoryToMarkdown,
  syncWithPlatform,
  getSupportedPlatforms,
} from "./cross-agent-memory.js";

const root = cwd();
const settings = loadSettings(root);
const [command, ...args] = process.argv.slice(2);

function readFailOnThreshold(args: string[]): QualityGateThreshold | "invalid" | undefined {
  const index = args.indexOf("--fail-on");
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (value === "high" || value === "medium" || value === "low") return value;

  return "invalid";
}

switch (command) {
  case "search": {
    try {
      const options = readSearchOptions(args);
      console.log(JSON.stringify(searchCodebase(root, settings, options), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "scan":
  case "update": {
    try {
      const dryRun = args.includes("--dry-run");
      const graph = await scanCodebase(root, settings);
      if (dryRun) {
        console.log(
          JSON.stringify(
            {
              dryRun: true,
              wouldWrite: ".codegraph/graph.db",
              nodes: graph.nodes.length,
              edges: graph.edges.length,
              filesScanned: graph.metadata.filesScanned,
              languages: graph.metadata.languages,
            },
            null,
            2,
          ),
        );
      } else {
        await writeGraph(root, graph);
        console.log(
          JSON.stringify(
            {
              graph: ".codegraph/graph.db",
              nodes: graph.nodes.length,
              edges: graph.edges.length,
              filesScanned: graph.metadata.filesScanned,
            },
            null,
            2,
          ),
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "query": {
    try {
      await ensureGraph();
      const query = args.join(" ").trim();
      if (!query) {
        console.error("Query string is required and must not be empty.");
        process.exitCode = 1;
        break;
      }
      console.log(JSON.stringify(queryGraph(await readGraph(root), query), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "impact": {
    try {
      await ensureGraph();
      const target = args.join(" ").trim();
      if (!target) {
        console.error("Target string is required and must not be empty.");
        process.exitCode = 1;
        break;
      }
      console.log(
        JSON.stringify(analyzeImpact(await readGraph(root), target, settings.maxDepth), null, 2),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "cycles": {
    try {
      await ensureGraph();
      console.log(JSON.stringify(findCycles(await readGraph(root)), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "orphans": {
    try {
      await ensureGraph();
      console.log(JSON.stringify(findOrphans(await readGraph(root)), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "summary": {
    try {
      await ensureGraph();
      console.log(JSON.stringify(summarizeArchitecture(await readGraph(root)), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "quality": {
    try {
      await ensureGraph();
      const report = analyzeGraphQuality(await readGraph(root), root);
      const threshold = readFailOnThreshold(args);

      if (threshold === "invalid") {
        console.error("Invalid --fail-on threshold. Use high, medium, or low.");
        process.exitCode = 1;
        break;
      }

      if (threshold) {
        const gate = evaluateQualityGate(report.issues, threshold);
        console.log(JSON.stringify({ ...report, ...gate }, null, 2));
        if (gate.wouldFail) {
          process.exitCode = 1;
        }
      } else {
        console.log(JSON.stringify(report, null, 2));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "export": {
    try {
      await ensureGraph();
      const formats = args.length ? args : settings.exports;
      console.log(
        JSON.stringify({ written: exportGraph(root, await readGraph(root), formats) }, null, 2),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "ui": {
    try {
      await ensureGraph();
      const url = await openGraphUi(root, settings);
      console.log(JSON.stringify({ url }, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "diff": {
    if (args.length < 2) {
      console.error("Usage: codegraph-mapper diff <before.json> <after.json>");
      process.exitCode = 1;
      break;
    }
    try {
      const before = JSON.parse(readFileSync(args[0], "utf8"));
      const after = JSON.parse(readFileSync(args[1], "utf8"));
      console.log(formatGraphDiff(diffGraphs(before, after)));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "mcp": {
    // Start the MCP server using the bundled server entrypoint.
    // Importing the compiled mcp-server module will run its top-level startup logic.
    await import("./mcp-server.js");
    break;
  }
  // ─── Headroom: CCR ────────────────────────────────────────────────
  case "compress": {
    const stdin = await readStdin();
    if (!stdin) {
      console.error("Usage: coder-workflow compress [--json|--code|--prose] < input.txt");
      process.exitCode = 1;
      break;
    }
    const ct = args.includes("--json") ? "json" : args.includes("--code") ? "code" : args.includes("--prose") ? "prose" : "auto";
    console.log(JSON.stringify(compress(stdin, { contentType: ct }), null, 2));
    break;
  }
  case "decompress": {
    const ccrId = args.join(" ").trim();
    if (!ccrId) {
      console.error("Usage: coder-workflow decompress <ccr-id>");
      process.exitCode = 1;
      break;
    }
    const result = decompress(ccrId);
    if (result) {
      console.log(result.original);
    } else {
      console.error(`CCR ID not found: ${ccrId}`);
      process.exitCode = 1;
    }
    break;
  }
  case "ccr-stats": {
    const stats = getCompressionStats();
    console.log(JSON.stringify(stats, null, 2));
    break;
  }
  case "ccr-clean": {
    const maxAge = parseInt(args[0] ?? "24", 10);
    console.log(JSON.stringify({ purged: cleanCCR(maxAge) }, null, 2));
    break;
  }

  // ─── Headroom: CacheAligner ───────────────────────────────────────
  case "align-cache": {
    const stdin = await readStdin();
    if (!stdin) {
      console.error("Usage: coder-workflow align-cache [--type system|agent|skill] [--sub-type <name>] [--task <desc>] < input.txt");
      process.exitCode = 1;
      break;
    }
    const type = readFlag(args, "--type") || undefined;
    const subType = readFlag(args, "--sub-type") || undefined;
    const task = readFlag(args, "--task") || undefined;
    console.log(JSON.stringify(alignCache(stdin, { taskType: type, mode: subType, projectName: task }), null, 2));
    break;
  }
  case "cache-stats": {
    console.log(JSON.stringify(getCacheAlignment(), null, 2));
    break;
  }

  // ─── Headroom: Learn ──────────────────────────────────────────────
  case "learn-analyze": {
    const analysis = analyzeFailures();
    if (args.includes("--apply")) {
      const applied = applyCorrections(analysis.suggestions);
      console.log(JSON.stringify({ ...analysis, applied: applied.written, memoryFiles: applied.memoryFiles }, null, 2));
    } else {
      console.log(JSON.stringify(analysis, null, 2));
    }
    break;
  }
  case "learn-report": {
    console.log(JSON.stringify(getLearnReport(), null, 2));
    break;
  }
  case "learn-log": {
    const type = readFlag(args, "--type");
    const error = readFlag(args, "--error");
    if (!type || !error) {
      console.error("Usage: coder-workflow learn-log --type <tool_failure|stop_failure|session_failure|test_failure> --error <message>");
      process.exitCode = 1;
      break;
    }
    const record = logFailure({
      type: type as "tool_failure" | "stop_failure" | "session_failure" | "test_failure",
      tool: readFlag(args, "--tool") || undefined,
      error,
      context: readFlag(args, "--context") || undefined,
    });
    console.log(JSON.stringify(record, null, 2));
    break;
  }
  case "learn-resolve": {
    const id = args[0];
    if (!id) {
      console.error("Usage: coder-workflow learn-resolve <failure-id> [--resolution <text>]");
      process.exitCode = 1;
      break;
    }
    const success = resolveFailure(id, readFlag(args, "--resolution") || undefined);
    console.log(JSON.stringify({ resolved: success, id }, null, 2));
    break;
  }
  case "learn-match": {
    const error = args.join(" ");
    if (!error) {
      console.error("Usage: coder-workflow learn-match <error-message>");
      process.exitCode = 1;
      break;
    }
    const match = matchCorrection(error);
    console.log(JSON.stringify({ matched: match !== undefined, correction: match ?? null }, null, 2));
    break;
  }

  // ─── Headroom: Cross-Agent Memory ─────────────────────────────────
  case "memory-store": {
    const name = readFlag(args, "--name");
    const desc = readFlag(args, "--description");
    const content = readFlag(args, "--content");
    const agentName = readFlag(args, "--agent");
    if (!name || !desc || !content || !agentName) {
      console.error("Usage: coder-workflow memory-store --name <slug> --description <text> --content <text> --agent <name> [--platform claude|codex|gemini|cursor] [--type lesson|decision|fact|reference|feedback] [--tags a,b,c]");
      process.exitCode = 1;
      break;
    }
    const platform = (readFlag(args, "--platform") || "claude") as "claude" | "codex" | "gemini" | "cursor" | "other";
    const memoryType = (readFlag(args, "--type") || "lesson") as "lesson" | "decision" | "fact" | "reference" | "feedback";
    const tags = (readFlag(args, "--tags") || "").split(",").filter(Boolean);
    const entry = storeMemory({ name, description: desc, content, agentName, platform, tags, memoryType });
    console.log(JSON.stringify(entry, null, 2));
    break;
  }
  case "memory-query": {
    const results = queryMemory({
      searchText: readFlag(args, "--search") || undefined,
      platforms: readFlag(args, "--platforms")?.split(",").filter(Boolean) as string[] | undefined,
      agentName: readFlag(args, "--agent") || undefined,
      memoryType: readFlag(args, "--type") || undefined,
      tags: readFlag(args, "--tags")?.split(",").filter(Boolean),
      limit: parseInt(readFlag(args, "--limit") ?? "20", 10),
    });
    console.log(JSON.stringify({ results, count: results.length }, null, 2));
    break;
  }
  case "memory-stats": {
    console.log(JSON.stringify(getMemoryStats(), null, 2));
    break;
  }
  case "memory-export": {
    const platforms = readFlag(args, "--platforms")?.split(",").filter(Boolean) as string[] | undefined;
    const memoryType = readFlag(args, "--type") || undefined;
    console.log(exportMemoryToMarkdown({ platforms, memoryType }));
    break;
  }
  case "memory-sync": {
    const platform = args[0];
    if (!platform) {
      console.error("Usage: coder-workflow memory-sync <claude|codex|gemini|cursor|other>");
      process.exitCode = 1;
      break;
    }
    const result = syncWithPlatform(platform as "claude" | "codex" | "gemini" | "cursor" | "other");
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "memory-platforms": {
    console.log(JSON.stringify({ platforms: getSupportedPlatforms() }, null, 2));
    break;
  }

  // ─── Dashboard ────────────────────────────────────────────────────
  case "dashboard": {
    try {
      startDashboard();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  /**
   * usage() called below this case.
   */
  case "help":
  case "--help":
  case "-h":
    console.log(`coder-workflow — CodeGraph CLI & MCP Server

USAGE:
  coder-workflow scan              Build or refresh the codebase graph database
  coder-workflow update            Incremental update (changed files only)
  coder-workflow search <pattern>  Search source code by text or regex
  coder-workflow query <query>     Query the graph (definitions, references, callers, etc.)
  coder-workflow impact <target>   Analyze upstream/downstream dependency impact
  coder-workflow cycles            Detect circular dependencies
  coder-workflow orphans           Find unreferenced files/symbols
  coder-workflow summary           Print architecture summary (entry points, hotspots)
  coder-workflow quality           Run quality analysis [--fail-on high|medium|low]
  coder-workflow export            Export graph [json|mermaid|dot|markdown|html]
  coder-workflow diff <a> <b>      Compare two graph JSON exports
  coder-workflow ui                Start interactive graph UI (http://localhost:3737)
  coder-workflow dashboard         Open terminal dashboard (TUI)
  coder-workflow mcp               Start MCP server (stdio transport, for .mcp.json)
  coder-workflow help              Show this help

SEARCH OPTIONS:
  --regex           Pattern is a regular expression
  --case-sensitive  Case-sensitive matching
  --context <n>     Lines of context around matches
  --max-results <n> Maximum results to return
  --include <pat>   File glob to include (repeatable)
  --exclude <pat>   File glob to exclude (repeatable)

MCP INTEGRATION:
  Add to .mcp.json:
  { "mcpServers": { "codegraph": {
      "type": "stdio",
      "command": "coder-workflow",
      "args": ["mcp"],
      "env": { "CODEGRAPH_DEFAULT_UI_PORT": "3737" }
  } } }

EXAMPLES:
  coder-workflow scan
  coder-workflow query "src/graph/db.ts:GraphDatabase.open"
  coder-workflow impact "src/types.ts:CodeGraph"
  coder-workflow search "TODO|FIXME" --regex --context 2
  coder-workflow quality --fail-on high
  coder-workflow export json mermaid html
  coder-workflow compress --json < response.json    # Headroom CCR
  coder-workflow decompress <ccr-id>                  # Headroom CCR
  coder-workflow learn-analyze --apply                # Headroom Learn
  coder-workflow memory-store --name <slug> ...       # Cross-Agent Memory
`);
    break;
  default:
    console.log(
      "Usage: coder-workflow <scan|update|search|query|impact|cycles|orphans|summary|quality [--fail-on high|medium|low]|export|diff|ui|dashboard|mcp|compress|decompress|ccr-stats|ccr-clean|align-cache|cache-stats|learn-analyze|learn-report|learn-log|learn-resolve|learn-match|memory-store|memory-query|memory-stats|memory-export|memory-sync|memory-platforms|help>",
    );
    console.log("Quick start: coder-workflow scan && coder-workflow summary");
    console.log("Full help:   coder-workflow help");
}

async function ensureGraph(): Promise<void> {
  if (!(await graphExists(root))) {
    throw new Error("Missing .codegraph/graph.db. Run scan first.");
  }
}

function readSearchOptions(args: string[]) {
  const pattern = args.find((arg) => !arg.startsWith("--"));
  if (!pattern) throw new Error("Search pattern is required.");

  const knownFlags = new Set([
    "--regex",
    "--case-sensitive",
    "--context",
    "--max-results",
    "--max-file-size",
    "--include",
    "--exclude",
  ]);
  for (const arg of args) {
    if (arg.startsWith("--") && !knownFlags.has(arg))
      throw new Error(`Unknown search option: ${arg}`);
  }

  return {
    pattern,
    regex: args.includes("--regex"),
    caseSensitive: args.includes("--case-sensitive"),
    contextLines: readNumberArg(args, "--context"),
    maxResults: readNumberArg(args, "--max-results"),
    maxFileSizeBytes: readNumberArg(args, "--max-file-size"),
    include: readRepeatedStringArg(args, "--include"),
    exclude: readRepeatedStringArg(args, "--exclude"),
  };
}

function readNumberArg(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} requires a finite number.`);
  return value;
}

function readRepeatedStringArg(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    values.push(value);
  }
  return values;
}

/**
 * Read stdin as a string. Returns null if stdin is a TTY.
 */
async function readStdin(): Promise<string | null> {
  const isTTY = process.stdin.isTTY ?? false;
  if (isTTY) return null;

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Read a named flag from the args list.
 */
function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}
