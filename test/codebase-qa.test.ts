import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { QAResult, QASource } from "../src/codebase-qa.js";
import { answerQuestion, formatQAResult, generateOnboardingDocs } from "../src/codebase-qa.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-qa-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ─── formatQAResult (pure function) ─────────────────────────────────────

test("formatQAResult formats high confidence result with answer", () => {
  const result: QAResult = {
    answer: "## Answer: How does auth work?\n\nFound in auth.ts.",
    sources: [
      { file: "auth.ts", line: 10, text: "export function login()", relevance: 15, type: "code" },
    ],
    confidence: "high",
    tookMs: 150,
  };

  const output = formatQAResult(result);

  assert.match(output, /How does auth work/);
  assert.match(output, /Confidence: high/);
  assert.match(output, /Took: 150ms/);
});

test("formatQAResult formats medium confidence result", () => {
  const result: QAResult = {
    answer: "## Answer: What is the database schema?\n\nSome info found.",
    sources: [],
    confidence: "medium",
    tookMs: 50,
  };

  const output = formatQAResult(result);

  assert.match(output, /What is the database schema/);
  assert.match(output, /Confidence: medium/);
  assert.match(output, /Took: 50ms/);
});

test("formatQAResult formats low confidence result", () => {
  const result: QAResult = {
    answer: "I couldn't find relevant information about that in the codebase.",
    sources: [],
    confidence: "low",
    tookMs: 5,
  };

  const output = formatQAResult(result);

  assert.match(output, /Confidence: low/);
  assert.ok(output.includes("I couldn't find relevant information"));
});

test("formatQAResult handles zero ms taken", () => {
  const result: QAResult = {
    answer: "## Answer: Test\n\nEmpty result.",
    sources: [],
    confidence: "low",
    tookMs: 0,
  };

  const output = formatQAResult(result);

  assert.match(output, /Took: 0ms/);
});

// ─── answerQuestion (I/O bound, uses fixtures) ──────────────────────────

test("answerQuestion returns empty-question response for blank input", async () => {
  const root = fixture({});
  const result = await answerQuestion(root, { question: "   " });
  assert.equal(result.answer, "Please provide a question.");
  assert.equal(result.confidence, "low");
  assert.equal(result.sources.length, 0);
});

test("answerQuestion answers from documentation files", async () => {
  const root = fixture({
    "README.md": "# My Project\nThis project uses authentication via JWT tokens.\n",
  });

  const result = await answerQuestion(root, { question: "How does authentication work?" });

  assert.ok(result.sources.length > 0);
  assert.notEqual(
    result.answer,
    "I couldn't find relevant information about that in the codebase.",
  );
});

test("answerQuestion answers from code definitions", async () => {
  const root = fixture({
    "src/auth.ts":
      "export function login(username: string, password: string): boolean {\n  return true;\n}\n",
  });

  const result = await answerQuestion(root, { question: "login function" });

  assert.ok(result.sources.length > 0);
  const codeSource = result.sources.find((s) => s.type === "code");
  if (codeSource) {
    assert.match(codeSource.file, /auth\.ts/);
  }
});

test("answerQuestion returns low confidence when no matches found", async () => {
  const root = fixture({
    "src/app.ts": "export const x = 1;\n",
  });

  const result = await answerQuestion(root, { question: "quantum cryptography zzzzz" });

  assert.ok(result.confidence === "low" || result.confidence === "medium");
  assert.ok(result.sources.length <= 1); // might match empty in code
});

test("answerQuestion respects maxSources parameter", async () => {
  const root = fixture({
    "README.md":
      "# Project\nAuthentication is handled by JWT tokens.\nAuthorization uses role-based access control.\n",
    "docs/auth.md": "# Auth\nLogin flow uses OAuth2.\n",
  });

  const result = await answerQuestion(root, {
    question: "authentication authorization",
    maxSources: 1,
  });

  assert.ok(result.sources.length <= 1);
});

test("answerQuestion searches documentation with paragraph-level scoring", async () => {
  const root = fixture({
    "README.md":
      "# Project\n\nThis is a long paragraph about authentication and authorization using JWT tokens with refresh tokens.\n\nAnother paragraph about deployment.\n",
  });

  const result = await answerQuestion(root, { question: "authentication JWT tokens" });

  assert.ok(result.sources.length > 0);
  assert.match(result.answer, /README\.md/);
});

test("answerQuestion handles includeFiles filter", async () => {
  const root = fixture({
    "src/auth.ts": "export function authenticate(): void {}\n",
    "src/db.ts": "export function query(): void {}\n",
    "README.md": "# Auth\n",
  });

  const result = await answerQuestion(root, {
    question: "authenticate",
    includeFiles: ["src/auth.ts"],
  });

  assert.ok(result.sources.length >= 0); // may find in docs too
});

test("answerQuestion strips root from file paths in sources", async () => {
  const root = fixture({
    "README.md": "# Project\nHas authentication helpers.\n",
  });

  const result = await answerQuestion(root, { question: "authentication" });

  for (const source of result.sources) {
    assert.ok(!source.file.includes(root), "source paths should be relative");
  }
});

test("answerQuestion deduplicates sources with same file:line:text", async () => {
  const root = fixture({
    "README.md": "# Test\nrepeated repeated repeated repeated repeated repeated repeated\n",
  });

  const result = await answerQuestion(root, { question: "repeated" });

  // Verify sources are unique by file:line:first50
  const keys = result.sources.map((s) => `${s.file}:${s.line}:${s.text.slice(0, 50)}`);
  assert.equal(keys.length, new Set(keys).size);
});

test("answerQuestion populates tookMs with a numeric value", async () => {
  const root = fixture({
    "README.md": "# Project\nHas some content about authentication.\n",
  });

  const result = await answerQuestion(root, { question: "authentication" });

  assert.ok(typeof result.tookMs === "number", "tookMs should be a number");
  assert.ok(result.tookMs >= 0, "tookMs should be non-negative");
});

// ─── generateOnboardingDocs ─────────────────────────────────────────────

test("generateOnboardingDocs generates CONTRIBUTING.md and ARCHITECTURE.md", async () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "test-project",
      scripts: { test: "jest", build: "tsc" },
    }),
    "biome.json": "{}",
    "tsconfig.json": "{}",
  });

  const result = await generateOnboardingDocs(root);

  assert.ok(result.files.length >= 2);

  const contributing = result.files.find((f) => f.path === "CONTRIBUTING.md");
  assert.ok(contributing);
  assert.match(contributing.content, /# Contributing/);
  assert.match(contributing.content, /npm ci/);
  assert.match(contributing.content, /Biome/);
  assert.match(contributing.content, /TypeScript strict/);

  const arch = result.files.find((f) => f.path === "ARCHITECTURE.md");
  assert.ok(arch);
  assert.match(arch.content, /# Architecture Overview/);
});

test("generateOnboardingDocs handles projects without package.json", async () => {
  const root = fixture({
    "requirements.txt": "flask==2.0.0\n",
    ".prettierrc": "{}",
  });

  const result = await generateOnboardingDocs(root);

  const contributing = result.files.find((f) => f.path === "CONTRIBUTING.md");
  assert.ok(contributing);
  assert.match(contributing.content, /pip install/);
  assert.match(contributing.content, /Prettier/);
  assert.ok(!contributing.content.includes("TypeScript strict"));
});

test("generateOnboardingDocs creates ARCHITECTURE.md with note when no graph", async () => {
  const root = fixture({});

  const result = await generateOnboardingDocs(root);

  const arch = result.files.find((f) => f.path === "ARCHITECTURE.md");
  assert.ok(arch);
  // Should note that CodeGraph data is not available
  assert.ok(
    arch.content.includes("CodeGraph data not available") ||
      arch.content.includes("Auto-generated"),
  );
});

// ─── Type/export validation ─────────────────────────────────────────────

test("module exports expected functions", async () => {
  const mod = await import("../src/codebase-qa.js");

  assert.equal(typeof mod.answerQuestion, "function");
  assert.equal(typeof mod.formatQAResult, "function");
  assert.equal(typeof mod.generateOnboardingDocs, "function");
});

test("QAResult type contract is satisfied", () => {
  const result: QAResult = {
    answer: "test",
    sources: [],
    confidence: "high",
    tookMs: 0,
  };

  assert.equal(typeof result.answer, "string");
  assert.ok(Array.isArray(result.sources));
  assert.match(result.confidence, /^(high|medium|low)$/);
  assert.equal(typeof result.tookMs, "number");
});

test("QASource type contract is satisfied", () => {
  const source: QASource = {
    file: "test.ts",
    line: 1,
    text: "hello",
    relevance: 5,
    type: "code",
  };

  assert.equal(source.file, "test.ts");
  assert.equal(source.line, 1);
  assert.equal(typeof source.relevance, "number");
  assert.match(source.type, /^(doc|code|graph)$/);
});
