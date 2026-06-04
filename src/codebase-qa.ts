#!/usr/bin/env node
/**
 * Codebase Q&A Agent — RAG over codebase
 *
 * Answers questions about the codebase by searching through:
 * - README.md, CLAUDE.md, CONTRIBUTING.md
 * - Code comments
 * - CodeGraph symbol definitions
 * - Architecture summaries
 *
 * Uses keyword + embedding search to find relevant context, then
 * constructs an answer with file:line citations.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readGraph, graphExists } from "./graph.js";
import { listSourceFiles } from "./graph/files.js";
import { languageForPath } from "./graph/languages.js";
import { loadSettings } from "./settings.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface QAQuery {
  question: string;
  maxSources?: number;
  includeFiles?: string[];
}

export interface QASource {
  file: string;
  line: number;
  text: string;
  relevance: number;
  type: "doc" | "code" | "graph";
}

export interface QAResult {
  answer: string;
  sources: QASource[];
  confidence: "high" | "medium" | "low";
  tookMs: number;
}

// ─── Documentation Sources ──────────────────────────────────────────────

const DOC_FILES = [
  "README.md", "CLAUDE.md", "CONTRIBUTING.md",
  "CHANGELOG.md", "CHANGELOG",
  "docs/", "docs/adr/",
];

function getDocFiles(root: string): string[] {
  const files: string[] = [];
  for (const pattern of DOC_FILES) {
    const path = join(root, pattern);
    if (!existsSync(path)) continue;

    if (pattern.endsWith("/")) {
      // Directory — list .md files
      try {
        const { readdirSync } = require("node:fs") as typeof import("node:fs");
        for (const f of readdirSync(path)) {
          if (f.endsWith(".md")) files.push(join(path, f));
        }
      } catch {
        // skip
      }
    } else if (!pattern.includes("*")) {
      files.push(path);
    }
  }
  return files;
}

// ─── Simple Text Search ────────────────────────────────────────────────

function searchInText(text: string, query: string): number {
  const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const tLower = text.toLowerCase();
  let score = 0;

  for (const word of qWords) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = tLower.match(regex);
    if (matches) {
      score += matches.length * 2;
      // Bonus for exact phrase match
      if (tLower.includes(word)) score += 3;
    }
  }

  // Bonus for heading matches
  const headings = text.match(/^#+\s+.+/gm) ?? [];
  for (const heading of headings) {
    const hLow = heading.toLowerCase();
    for (const word of qWords) {
      if (hLow.includes(word)) score += 5;
    }
  }

  return score;
}

// ─── Main QA Function ──────────────────────────────────────────────────

export async function answerQuestion(root: string, query: QAQuery): Promise<QAResult> {
  const start = Date.now();
  const qText = query.question.trim();

  if (!qText) {
    return { answer: "Please provide a question.", sources: [], confidence: "low", tookMs: 0 };
  }

  const sources: QASource[] = [];
  const settings = loadSettings(root);

  // 1. Search documentation files
  const docFiles = getDocFiles(root);
  for (const file of docFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const rel = file.replace(root, "").replace(/^\//, "");

      for (let i = 0; i < lines.length; i++) {
        const score = searchInText(lines[i], qText);
        if (score > 0) {
          sources.push({
            file: rel,
            line: i + 1,
            text: lines[i].slice(0, 200),
            relevance: score,
            type: "doc",
          });
        }
      }

      // Also search paragraph-level
      const paragraphs = content.split("\n\n");
      for (const para of paragraphs) {
        const score = searchInText(para, qText);
        if (score > 3) {
          sources.push({
            file: rel,
            line: 0,
            text: para.slice(0, 200).replace(/\n/g, " "),
            relevance: score,
            type: "doc",
          });
        }
      }
    } catch {
      // skip unreadable
    }
  }

  // 2. Search code files for definitions
  const maxFiles = query.includeFiles
    ? query.includeFiles.map((f) => join(root, f)).filter((f) => existsSync(f))
    : listSourceFiles(root, settings).slice(0, 100);

  for (const file of maxFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      const rel = file.replace(root, "").replace(/^\//, "");
      languageForPath(file); // warm cache

      // Extract definitions (function/class signatures)
      const defLines: string[] = [];
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match function/class/interface definitions
        if (line.match(/\b(function|class|interface|type|enum|const|let|var|def|fn|pub)\s+\w/)) {
          defLines.push(line);
          // Include next line if it's a signature continuation
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith("(")) {
            defLines[defLines.length - 1] += " " + lines[i + 1].trim();
          }
        }
      }

      for (const def of defLines) {
        const score = searchInText(def, qText);
        if (score > 0) {
          const lineNum = lines.findIndex((l) => l.trim() === def.trim()) + 1;
          sources.push({
            file: rel,
            line: lineNum || 0,
            text: def.slice(0, 200),
            relevance: score * 1.5, // boost definitions
            type: "code",
          });
        }
      }
    } catch {
      // skip
    }
  }

  // 3. Search CodeGraph if available
  try {
    if (await graphExists(root)) {
      const graph = await readGraph(root);
      for (const node of graph.nodes) {
        if (node.type === "function" || node.type === "class") {
          const score = searchInText(node.name, qText);
          if (score > 0) {
            sources.push({
              file: node.path,
              line: node.startLine ?? 0,
              text: `${node.type}: ${node.name}`,
              relevance: score * 2,
              type: "graph",
            });
          }
        }
      }
    }
  } catch {
    // graph not available — skip
  }

  // Sort by relevance descending, deduplicate
  sources.sort((a, b) => b.relevance - a.relevance);
  const seen = new Set<string>();
  const deduped = sources.filter((s) => {
    const key = `${s.file}:${s.line}:${s.text.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const maxSources = query.maxSources ?? 8;
  const topSources = deduped.slice(0, maxSources);

  // Generate answer from top sources
  const answer = synthesizeAnswer(qText, topSources);

  const confidence: QAResult["confidence"] = topSources.length > 3
    ? "high"
    : topSources.length > 0
      ? "medium"
      : "low";

  return {
    answer,
    sources: topSources,
    confidence,
    tookMs: Date.now() - start,
  };
}

// ─── Answer Synthesis ──────────────────────────────────────────────────

function synthesizeAnswer(question: string, sources: QASource[]): string {
  if (sources.length === 0) {
    return "I couldn't find relevant information about that in the codebase. Try a more specific question or check the documentation files directly.";
  }

  const codeSources = sources.filter((s) => s.type === "code" || s.type === "graph");
  const docSources = sources.filter((s) => s.type === "doc");

  const parts: string[] = [];

  parts.push(`## Answer: ${question}`, "");

  if (codeSources.length > 0) {
    const best = codeSources[0];
    parts.push(`Found in **${best.file}** (line ${best.line}):`);
    parts.push(`> ${best.text}`);
    parts.push("");
  }

  if (docSources.length > 0) {
    parts.push("### Documentation references", "");
    for (const src of docSources.slice(0, 3)) {
      parts.push(`- \`${src.file}:${src.line}\` — ${src.text.slice(0, 100)}`);
    }
    parts.push("");
  }

  parts.push("### Sources", "");
  for (const src of sources) {
    const icon = src.type === "doc" ? "📄" : src.type === "code" ? "💻" : "🔗";
    parts.push(`- ${icon} \`${src.file}:${src.line}\` (relevance: ${src.relevance})`);
  }

  return parts.join("\n");
}

// ─── Onboarding Docs Generator ─────────────────────────────────────────

export async function generateOnboardingDocs(root: string): Promise<{
  files: Array<{ path: string; content: string }>;
}> {
  const files: Array<{ path: string; content: string }> = [];

  // CONTRIBUTING.md
  let contributingContent = "# Contributing\n\n## Getting Started\n\n";
  contributingContent += "1. Clone the repository\n";
  contributingContent += "2. Install dependencies\n";
  if (existsSync(join(root, "package.json"))) contributingContent += "3. Run `npm ci`\n";
  if (existsSync(join(root, "requirements.txt"))) contributingContent += "3. Run `pip install -r requirements.txt`\n";

  contributingContent += "\n## Development\n\n";
  if (existsSync(join(root, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (scripts) {
      contributingContent += "### Available Scripts\n\n";
      for (const [name, cmd] of Object.entries(scripts)) {
        contributingContent += `- \`npm run ${name}\`: ${cmd}\n`;
      }
    }
  }

  contributingContent += "\n## Code Style\n\n";
  if (existsSync(join(root, "biome.json"))) contributingContent += "- This project uses Biome for formatting and linting\n";
  if (existsSync(join(root, ".prettierrc"))) contributingContent += "- This project uses Prettier for formatting\n";
  if (existsSync(join(root, "tsconfig.json"))) contributingContent += "- TypeScript strict mode is enabled\n";
  contributingContent += "\n## Pull Request Process\n\n";
  contributingContent += "1. Create a feature branch from `main`\n";
  contributingContent += "2. Make your changes\n";
  contributingContent += "3. Run tests and lint\n";
  contributingContent += "4. Submit a PR with a clear description\n";

  files.push({ path: "CONTRIBUTING.md", content: contributingContent });

  // Architecture overview from CodeGraph if available
  let archContent = "# Architecture Overview\n\n";
  archContent += "*Auto-generated from CodeGraph data*\n\n";

  try {
    if (await graphExists(root)) {
      const graph = await readGraph(root);

      // Languages
      const langs = [...new Set(graph.nodes.map((n) => n.language).filter(Boolean))];
      archContent += `## Languages\n\n${langs.map((l) => `- ${l}`).join("\n")}\n\n`;

      // Node types
      const types = new Map<string, number>();
      for (const n of graph.nodes) {
        if (n.type !== "file" && n.type !== "module") {
          types.set(n.type, (types.get(n.type) ?? 0) + 1);
        }
      }
      archContent += "## Components\n\n";
      for (const [type, count] of types) {
        archContent += `- ${type}: ${count}\n`;
      }
      archContent += "\n";

      // Entry points
      const entryPoints = graph.nodes.filter(
        (n) => n.type === "function" && (n.name === "main" || n.name === "handler" || n.name === "start"),
      );
      if (entryPoints.length > 0) {
        archContent += "## Entry Points\n\n";
        for (const ep of entryPoints) {
          archContent += `- \`${ep.name}\` in \`${ep.path}\`\n`;
        }
        archContent += "\n";
      }
    }
  } catch {
    archContent += "> CodeGraph data not available. Run `scan_codebase` to generate architecture overview.\n\n";
  }

  archContent += "\n*Generated by coder-workflow onboarding-docs*";
  files.push({ path: "ARCHITECTURE.md", content: archContent });

  return { files };
}

// ─── Formatting ────────────────────────────────────────────────────────

export function formatQAResult(result: QAResult): string {
  const lines = [
    result.answer,
    "",
    `_Confidence: ${result.confidence} | Took: ${result.tookMs}ms_`,
  ];
  return lines.join("\n");
}
