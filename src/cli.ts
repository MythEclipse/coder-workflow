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
import { exportGraph } from "./exporters.js";
import { diffGraphs, formatGraphDiff } from "./git-diff.js";
import { graphExists, readGraph, scanCodebase, writeGraph } from "./graph.js";
import { searchCodebase } from "./search.js";
import { loadSettings } from "./settings.js";
import { openGraphUi } from "./ui.js";
import { startDashboard } from "./dashboard.js";

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
      const graph = await scanCodebase(root, settings);
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
  case "dashboard": {
    try {
      startDashboard();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  default:
    console.log(
      "Usage: codegraph-mapper <scan|update|search|query|impact|cycles|orphans|summary|quality [--fail-on high|medium|low]|export|diff|ui|mcp|dashboard>",
    );
    console.log("Quick start: codegraph-mapper scan && codegraph-mapper summary");
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
