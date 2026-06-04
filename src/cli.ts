#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
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
import { detectDeadCodeFromGraph } from "./deadcode.js";
import { semanticSearch, buildEmbeddings, getEmbeddingStats } from "./semantic-search.js";
import { generatePRDescription, generateChangelog, formatChangelogMarkdown, createRelease } from "./release.js";
import { scanForSecrets, formatSecretsReport } from "./secrets.js";
import { createADR, listADRs, getADR, updateADRStatus, generateADRGraph, formatADRList, initADR } from "./adr.js";
import { scanVulnerabilities, generateSBOM, formatVulnReport } from "./vuln-sbom.js";
import { answerQuestion, generateOnboardingDocs, formatQAResult } from "./codebase-qa.js";
import { generateSprintReport, getTeamMetrics, checkPRAutoMerge, recordBenchmark, getBenchmarkHistory, detectBenchmarkRegression } from "./tier3.js";
import { compareOpenApiSpecs, diffOpenApiFromGit, formatContractReport } from "./api-contract.js";
import { validateEnvFile, validateJsonFile, detectMissingEnvVars, formatValidationReport } from "./config-validator.js";
import { scanNpmLicenses, categorizeLicenses, formatLicenseReport } from "./license-checker.js";
import { analyzeDirectory, trackComplexityTrend, formatComplexityReport } from "./complexity-tracker.js";
import { analyzeLogFile, formatLogReport } from "./log-analyzer.js";
import { aggregateCoverage, checkCoverageThreshold, formatCoverageReport } from "./coverage-aggregator.js";
import { scaffoldHooks, validateCommitMessage, formatHookError, detectExistingHooks } from "./git-hooks.js";
import { scanForTodos, formatTodoReport, getTodoHistory } from "./todo-tracker.js";
import { analyzeBundleStats, parseBundlePhobia, compareBundles, formatBundleReport, createPerfReport } from "./performance-audit.js";
import { extractHardcodedStrings, checkMissingTranslation, formatLocaleReport } from "./i18n-helper.js";
import { parsePrismaSchema, compareSchemas, formatSchemaReport, formatSchemaDiff } from "./db-schema.js";
import { generateDoctorReport, formatDoctorReport } from "./doctor.js";
import { generateStats, getStatsHistory, recordStats, compareStats, formatStats, formatStatsHistory } from "./codebase-stats.js";

import {
  readFlag,
  readSearchOptions,
  readFailOnThreshold,
} from "./args.js";

const root = cwd();
const settings = loadSettings(root);
const [command, ...args] = process.argv.slice(2);

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

  // ─── New Features: Dead Code ─────────────────────────────────────
  case "dead-code": {
    try {
      const result = await detectDeadCodeFromGraph(root);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── New Features: Semantic Search ────────────────────────────────
  case "semantic-search": {
    try {
      const query = args.join(" ").trim();
      if (!query && !args.includes("--build")) {
        console.error("Usage: coder-workflow semantic-search <query> [--max-results 20] or coder-workflow semantic-search --build");
        process.exitCode = 1;
        break;
      }
      if (args.includes("--build")) {
        const result = buildEmbeddings(root, settings);
        console.log(JSON.stringify(result, null, 2));
      } else {
        const result = semanticSearch(root, settings, {
          query,
          maxResults: parseInt(readFlag(args, "--max-results") ?? "20", 10),
          include: readFlag(args, "--include")?.split(",").filter(Boolean),
          exclude: readFlag(args, "--exclude")?.split(",").filter(Boolean),
        });
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "embedding-stats": {
    console.log(JSON.stringify(getEmbeddingStats(root), null, 2));
    break;
  }

  // ─── New Features: PR & Changelog ─────────────────────────────────
  case "pr": {
    const pr = generatePRDescription({
      targetBranch: readFlag(args, "--target") || undefined,
    });
    console.log(pr.body);
    break;
  }
  case "changelog": {
    const entries = generateChangelog(
      readFlag(args, "--from") || undefined,
      readFlag(args, "--to") || undefined,
    );
    console.log(formatChangelogMarkdown(entries));
    break;
  }
  case "release": {
    const bump = args[0];
    if (!bump || !["patch", "minor", "major"].includes(bump)) {
      console.error("Usage: coder-workflow release <patch|minor|major>");
      process.exitCode = 1;
      break;
    }
    const release = createRelease(bump as "patch" | "minor" | "major");
    console.log(JSON.stringify(release, null, 2));
    break;
  }

  // ─── New Features: Secrets Scanner ────────────────────────────────
  case "secrets": {
    const report = scanForSecrets(root, {
      severity: readFlag(args, "--severity") as "high" | "medium" | "low" | undefined,
    });
    console.log(formatSecretsReport(report));
    break;
  }

  // ─── New Features: ADR Manager ────────────────────────────────────
  case "adr": {
    const sub = args[0];
    if (!sub) {
      console.error("Usage: coder-workflow adr <new|list|get|status|graph|init> [args...]");
      process.exitCode = 1;
      break;
    }
    switch (sub) {
      case "init": console.log(JSON.stringify(initADR(), null, 2)); break;
      case "new": {
        const title = readFlag(args, "--title");
        if (!title) { console.error("Usage: coder-workflow adr new --title <title> [--status proposed|accepted]"); process.exitCode = 1; break; }
        console.log(JSON.stringify(createADR({ title, status: (readFlag(args, "--status") || "proposed") as any }), null, 2));
        break;
      }
      case "list": console.log(formatADRList(listADRs())); break;
      case "get": {
        const id = parseInt(args[1] ?? "0");
        const adr = getADR(id);
        if (!adr) { console.error(`ADR ${id} not found`); process.exitCode = 1; break; }
        console.log(adr.content);
        break;
      }
      case "status": {
        const id = parseInt(args[1] ?? "0");
        const status = readFlag(args, "--status");
        if (!status) { console.error("Usage: coder-workflow adr status <id> --status <accepted|proposed|deprecated|superseded>"); process.exitCode = 1; break; }
        const updated = updateADRStatus(id, status as any);
        if (!updated) { console.error(`ADR ${id} not found`); process.exitCode = 1; break; }
        console.log(`ADR ${id} status updated to: ${status}`);
        break;
      }
      case "graph": console.log(generateADRGraph()); break;
      default: console.error("Unknown adr subcommand. Use: new, list, get, status, graph, init"); process.exitCode = 1;
    }
    break;
  }

  // ─── New Features: Vulnerability Scanner ──────────────────────────
  case "vuln-scan": {
    const report = scanVulnerabilities(root);
    console.log(formatVulnReport(report));
    break;
  }
  case "sbom": {
    const format = (readFlag(args, "--format") || "spdx");
    const sbom = generateSBOM(root, format as "spdx" | "cyclonedx");
    console.log(sbom.content);
    break;
  }

  // ─── New Features: Codebase Q&A ───────────────────────────────────
  case "qa": {
    const question = args.join(" ");
    if (!question) {
      console.error("Usage: coder-workflow qa <question>");
      process.exitCode = 1;
      break;
    }
    const result = await answerQuestion(root, { question });
    console.log(formatQAResult(result));
    break;
  }
  case "onboarding-docs": {
    const docs = await generateOnboardingDocs(root);
    for (const doc of docs.files) {
      console.log(`--- ${doc.path} ---`);
      console.log(doc.content);
      console.log("");
    }
    break;
  }

  // ─── New Features: Tier 3 ─────────────────────────────────────────
  case "sprint": {
    const since = readFlag(args, "--since") || "7.days.ago";
    console.log(JSON.stringify(generateSprintReport(since), null, 2));
    break;
  }
  case "team-metrics": {
    console.log(JSON.stringify(getTeamMetrics(), null, 2));
    break;
  }
  case "pr-check": {
    const prNum = parseInt(args[0] ?? "0");
    if (!prNum) { console.error("Usage: coder-workflow pr-check <pr-number>"); process.exitCode = 1; break; }
    console.log(JSON.stringify(await checkPRAutoMerge(prNum), null, 2));
    break;
  }
  case "benchmark": {
    const sub = args[0];
    if (!sub) { console.error("Usage: coder-workflow benchmark <record|history|regression>"); process.exitCode = 1; break; }
    switch (sub) {
      case "record": {
        const name = readFlag(args, "--name");
        const duration = parseFloat(readFlag(args, "--duration") ?? "0");
        if (!name || !duration) { console.error("Usage: coder-workflow benchmark record --name <name> --duration <ms>"); process.exitCode = 1; break; }
        console.log(JSON.stringify(recordBenchmark(name, duration), null, 2));
        break;
      }
      case "history": {
        const name = readFlag(args, "--name");
        if (!name) { console.error("Usage: coder-workflow benchmark history --name <name>"); process.exitCode = 1; break; }
        const limit = parseInt(readFlag(args, "--limit") ?? "20", 10);
        console.log(JSON.stringify({ history: getBenchmarkHistory(name, limit) }, null, 2));
        break;
      }
      case "regression": {
        const name = readFlag(args, "--name");
        if (!name) { console.error("Usage: coder-workflow benchmark regression --name <name>"); process.exitCode = 1; break; }
        console.log(JSON.stringify({ regression: detectBenchmarkRegression(name) }, null, 2));
        break;
      }
      default: console.error("Unknown benchmark subcommand"); process.exitCode = 1;
    }
    break;
  }

  // ─── API Contract Tester ──────────────────────────────────────────
  case "api-contract": {
    try {
      const sub = args[0];
      if (sub === "diff") {
        const before = readFlag(args, "--before");
        const after = readFlag(args, "--after");
        if (!before || !after) {
          console.error("Usage: coder-workflow api-contract diff --before <openapi-before.json> --after <openapi-after.json>");
          process.exitCode = 1; break;
        }
        const report = compareOpenApiSpecs(before, after);
        console.log(formatContractReport(report));
      } else if (sub === "git-diff") {
        const ref1 = readFlag(args, "--ref1");
        const ref2 = readFlag(args, "--ref2");
        const report = diffOpenApiFromGit(ref1 || undefined, ref2 || undefined);
        console.log(formatContractReport(report));
      } else {
        console.error("Usage: coder-workflow api-contract diff|git-diff ...");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Config Validator ─────────────────────────────────────────────
  case "config-validator":
  case "validate": {
    try {
      const sub = args[0];
      if (sub === "env") {
        const schemaPath = readFlag(args, "--schema");
        const envPath = readFlag(args, "--env");
        if (!schemaPath) {
          console.error("Usage: coder-workflow validate env --schema <schema.json> [--env .env]");
          process.exitCode = 1; break;
        }
        const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
        const report = validateEnvFile(envPath || ".env", schema);
        console.log(formatValidationReport(report));
      } else if (sub === "json") {
        const filePath = readFlag(args, "--file");
        const schemaPath = readFlag(args, "--schema");
        if (!filePath || !schemaPath) {
          console.error("Usage: coder-workflow validate json --file <file.json> --schema <schema.json>");
          process.exitCode = 1; break;
        }
        const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
        const report = validateJsonFile(filePath, schema);
        console.log(formatValidationReport(report));
      } else if (sub === "missing-env") {
        const required = readFlag(args, "--required")?.split(",") || [];
        if (required.length === 0) {
          console.error("Usage: coder-workflow validate missing-env --required KEY1,KEY2");
          process.exitCode = 1; break;
        }
        const report = detectMissingEnvVars(required, readFlag(args, "--env") || undefined);
        console.log(formatValidationReport(report));
      } else {
        console.error("Usage: coder-workflow validate <env|json|missing-env> ...");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── License Checker ──────────────────────────────────────────────
  case "license-check":
  case "licenses": {
    try {
      const report = scanNpmLicenses(readFlag(args, "--root") || undefined);
      const categorized = categorizeLicenses(report);
      console.log(formatLicenseReport(categorized));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Complexity Tracker ───────────────────────────────────────────
  case "complexity": {
    try {
      const sub = args[0];
      if (sub === "scan") {
        const rootPath = readFlag(args, "--root") || ".";
        const report = analyzeDirectory(rootPath);
        console.log(formatComplexityReport(report));
      } else if (sub === "track") {
        const trend = trackComplexityTrend(readFlag(args, "--root") || ".");
        console.log(JSON.stringify(trend, null, 2));
      } else {
        console.error("Usage: coder-workflow complexity <scan|track> [--root <dir>]");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Log Analyzer ─────────────────────────────────────────────────
  case "log-analyze":
  case "logs": {
    try {
      const filePath = args[0];
      if (!filePath) {
        console.error("Usage: coder-workflow logs <filepath>");
        process.exitCode = 1; break;
      }
      const report = analyzeLogFile(filePath);
      console.log(formatLogReport(report));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Coverage Aggregator ──────────────────────────────────────────
  case "coverage": {
    try {
      const sub = args[0];
      if (sub === "check") {
        const threshold = parseFloat(readFlag(args, "--threshold") ?? "80");
        const sources = [];
        const jestPath = readFlag(args, "--jest");
        const vitestPath = readFlag(args, "--vitest");
        const lcovPath = readFlag(args, "--lcov");
        if (jestPath) sources.push({ tool: "jest" as const, path: jestPath });
        if (vitestPath) sources.push({ tool: "vitest" as const, path: vitestPath });
        if (lcovPath) sources.push({ tool: "istanbul" as const, path: lcovPath });
        if (sources.length === 0) {
          console.error("Usage: coder-workflow coverage check --threshold 80 [--jest <file>] [--vitest <file>] [--lcov <file>]");
          process.exitCode = 1; break;
        }
        const report = aggregateCoverage(sources);
        const gate = checkCoverageThreshold(report, threshold);
        console.log(formatCoverageReport(report));
        console.log(gate.pass ? "✅ Threshold passed" : "❌ Threshold failed");
        if (!gate.pass) console.log(JSON.stringify(gate.details, null, 2));
      } else {
        console.error("Usage: coder-workflow coverage check ...");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Git Hook Scaffolder ──────────────────────────────────────────
  case "hooks":
  case "git-hooks": {
    try {
      const sub = args[0];
      if (sub === "scaffold") {
        const hooks = readFlag(args, "--hooks")?.split(",") as Array<"pre-commit"|"commit-msg"|"pre-push"|"post-commit"|"post-merge"> | undefined;
        const linter = readFlag(args, "--linter") || undefined;
        const testCmd = readFlag(args, "--test") || undefined;
        if (!hooks || hooks.length === 0) {
          console.error("Usage: coder-workflow hooks scaffold --hooks pre-commit,commit-msg,pre-push [--linter eslint] [--test \"npm test\"]");
          process.exitCode = 1; break;
        }
        const existing = detectExistingHooks(process.cwd(), hooks);
        if (existing.length > 0) console.warn(`⚠️  Overwriting existing hooks: ${existing.join(", ")}`);
        const result = scaffoldHooks(process.cwd(), { hooks, linter, testCommand: testCmd });
        console.log(JSON.stringify(result, null, 2));
      } else if (sub === "validate-msg") {
        const msg = args.slice(1).join(" ");
        if (!msg) {
          console.error("Usage: coder-workflow hooks validate-msg <commit-message>");
          process.exitCode = 1; break;
        }
        const result = validateCommitMessage(msg);
        if (result.valid) console.log("✅ Valid commit message");
        else console.log(formatHookError(result.errors));
      } else {
        console.error("Usage: coder-workflow hooks <scaffold|validate-msg> ...");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Todo/Fixme Tracker ───────────────────────────────────────────
  case "todos":
  case "todo": {
    try {
      const sub = args[0] || "scan";
      if (sub === "scan") {
        const report = scanForTodos(root, {
          include: readFlag(args, "--include")?.split(","),
          exclude: readFlag(args, "--exclude")?.split(","),
        });
        console.log(formatTodoReport(report, { showAge: true, groupBy: readFlag(args, "--group-by") as 'type'|'file'|'author'|undefined }));
      } else if (sub === "history") {
        const reports = getTodoHistory(root);
        console.log(JSON.stringify(reports, null, 2));
      } else {
        console.error("Usage: coder-workflow todos [scan|history] [--group-by type|file|author]");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Performance Audit ────────────────────────────────────────────
  case "perf":
  case "performance": {
    try {
      const sub = args[0];
      if (sub === "bundle") {
        const statsPath = readFlag(args, "--stats");
        if (statsPath) {
          const report = analyzeBundleStats(statsPath);
          console.log(formatBundleReport(report));
        } else {
          const report = await parseBundlePhobia(root);
          console.log(formatBundleReport(report));
        }
      } else if (sub === "compare") {
        const before = analyzeBundleStats(readFlag(args, "--before") || "");
        const after = analyzeBundleStats(readFlag(args, "--after") || "");
        const diffs = compareBundles(before, after);
        console.log(JSON.stringify(diffs, null, 2));
      } else if (sub === "report") {
        const report = createPerfReport(root);
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.error("Usage: coder-workflow perf <bundle|compare|report> ...");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── i18n Helper ──────────────────────────────────────────────────
  case "i18n":
  case "locale": {
    try {
      const sub = args[0];
      if (sub === "extract") {
        const strings = extractHardcodedStrings(root, {
          excludePatterns: readFlag(args, "--exclude")?.split(","),
        });
        console.log(JSON.stringify({ total: strings.length, strings }, null, 2));
      } else if (sub === "check") {
        const localesDir = readFlag(args, "--locales") || "locales";
        const report = checkMissingTranslation(root, localesDir);
        console.log(formatLocaleReport(report));
      } else {
        console.error("Usage: coder-workflow i18n <extract|check> [--locales <dir>]");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── DB Schema Reporter ───────────────────────────────────────────
  case "db-schema": {
    try {
      const sub = args[0];
      if (sub === "prisma") {
        const schemaPath = readFlag(args, "--schema") || "prisma/schema.prisma";
        const report = parsePrismaSchema(schemaPath);
        console.log(formatSchemaReport(report));
      } else if (sub === "compare") {
        const before = parsePrismaSchema(readFlag(args, "--before") || "");
        const after = parsePrismaSchema(readFlag(args, "--after") || "");
        const diff = compareSchemas(before, after);
        console.log(formatSchemaDiff(diff));
      } else {
        console.error("Usage: coder-workflow db-schema <prisma|compare> ...");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Doctor (Environment Reporter) ────────────────────────────────
  case "doctor": {
    try {
      const report = generateDoctorReport(readFlag(args, "--root") || root);
      console.log(formatDoctorReport(report));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Codebase Stats Dashboard ─────────────────────────────────────
  case "stats":
  case "codebase-stats": {
    try {
      const sub = args[0] || "generate";
      if (sub === "generate") {
        const stats = recordStats(root);
        console.log(formatStats(stats));
      } else if (sub === "history") {
        const history = getStatsHistory(root);
        console.log(formatStatsHistory(history));
      } else if (sub === "compare") {
        const stats = generateStats(root);
        const history = getStatsHistory(root);
        if (history.reports.length > 0) {
          const comparison = compareStats(history.reports[history.reports.length - 1], stats);
          console.log(formatStats(stats));
          console.log(`\n📊 vs Last Snapshot: +${comparison.linesDiff} lines, ${comparison.filesDiff > 0 ? "+" : ""}${comparison.filesDiff} files`);
        } else {
          console.log(formatStats(stats));
          console.log("(No previous snapshot to compare against)");
        }
      } else {
        console.error("Usage: coder-workflow stats <generate|history|compare>");
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    break;
  }

  // ─── Sequential Thinking ──────────────────────────────────────────
  case "think": {
    try {
      const thoughtText = args.join(" ");
      if (!thoughtText) {
        console.error("Usage: coder-workflow think <your thought>");
        process.exitCode = 1;
        break;
      }
      const { SequentialThinkingEngine } = await import("./sequential-thinking.js");
      const engine = new SequentialThinkingEngine();
      const result = engine.processThought({
        thought: thoughtText,
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
      });
      const parsed = JSON.parse(result.content[0].text);
      console.log(JSON.stringify(parsed, null, 2));
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
  coder-workflow api-contract diff --before <a> --after <b>  # API Contract
  coder-workflow validate env --schema <schema>              # Config Validation
  coder-workflow licenses                                    # License Checker
  coder-workflow complexity scan                             # Code Complexity
  coder-workflow logs <file>                                 # Log Analyzer
  coder-workflow coverage check --threshold 80               # Coverage
  coder-workflow hooks scaffold --hooks pre-commit           # Git Hooks
  coder-workflow todos                                       # TODO Tracker
  coder-workflow perf bundle --stats <stats.json>            # Performance Audit
  coder-workflow i18n extract                                # i18n Helper
  coder-workflow db-schema prisma                            # DB Schema Reporter
  coder-workflow doctor                                      # Environment Check
  coder-workflow stats                                       # Codebase Stats
  coder-workflow compress --json < response.json    # Headroom CCR
  coder-workflow decompress <ccr-id>                  # Headroom CCR
  coder-workflow learn-analyze --apply                # Headroom Learn
  coder-workflow memory-store --name <slug> ...       # Cross-Agent Memory
	  coder-workflow think <thought>                      # Quick sequential thought
`);
    break;
  default:
    console.log(
      "Usage: coder-workflow <scan|update|search|query|impact|cycles|orphans|summary|quality [--fail-on high|medium|low]|export|diff|ui|mcp|compress|decompress|ccr-stats|ccr-clean|align-cache|cache-stats|learn-analyze|learn-report|learn-log|learn-resolve|learn-match|memory-store|memory-query|memory-stats|memory-export|memory-sync|memory-platforms|api-contract|validate|licenses|complexity|logs|coverage|hooks|todos|perf|i18n|db-schema|doctor|stats|help>",
    );
    console.log("Quick start: coder-workflow scan && coder-workflow summary");
    console.log("Full help:   coder-workflow help");
}

async function ensureGraph(): Promise<void> {
  if (!(await graphExists(root))) {
    throw new Error("Missing .codegraph/graph.db. Run scan first.");
  }
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
