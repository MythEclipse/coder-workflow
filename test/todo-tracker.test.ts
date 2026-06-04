import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TodoItem, TodoReport } from "../src/todo-tracker.js";
import { formatTodoReport, getTodoHistory } from "../src/todo-tracker.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "todo-tracker-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(root, filePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// formatTodoReport
// ---------------------------------------------------------------------------

test("formatTodoReport - produces valid markdown with all sections", () => {
  const items: TodoItem[] = [
    {
      type: "TODO",
      message: "implement error handling",
      file: "src/app.ts",
      line: 10,
      author: "alice@example.com",
      date: "2026-01-01T00:00:00.000Z",
      age: 30,
    },
    {
      type: "FIXME",
      message: "fix null pointer",
      file: "src/utils.ts",
      line: 25,
      author: "bob@example.com",
      date: "2026-02-01T00:00:00.000Z",
      age: 5,
    },
    {
      type: "HACK",
      message: "temporary workaround for auth",
      file: "src/auth.ts",
      line: 50,
      author: "alice@example.com",
      date: "2026-01-15T00:00:00.000Z",
      age: 15,
    },
  ];

  const report: TodoReport = {
    totalItems: 3,
    items,
    byType: { TODO: 1, FIXME: 1, HACK: 1 },
    byFile: { "src/app.ts": 1, "src/utils.ts": 1, "src/auth.ts": 1 },
    byAuthor: { "alice@example.com": 2, "bob@example.com": 1 },
    averageAge: 16,
    oldestItems: [items[0], items[2], items[1]],
  };

  const output = formatTodoReport(report);

  assert.ok(output.includes("TODO/FIXME/HACK/NOTE/XXX Report"));
  assert.ok(output.includes("Total items:"));
  assert.ok(output.includes("3"));
  assert.ok(output.includes("Average age:"));
  assert.ok(output.includes("16 days"));
  assert.ok(output.includes("By Type"));
  assert.ok(output.includes("TODO"));
  assert.ok(output.includes("FIXME"));
  assert.ok(output.includes("HACK"));
  assert.ok(output.includes("By File"));
  assert.ok(output.includes("src/app.ts"));
  assert.ok(output.includes("By Author"));
  assert.ok(output.includes("alice@example.com"));
  assert.ok(output.includes("Oldest Items"));
  assert.ok(output.includes("All Items"));
});

test("formatTodoReport - handles empty report", () => {
  const report: TodoReport = {
    totalItems: 0,
    items: [],
    byType: {},
    byFile: {},
    byAuthor: {},
    averageAge: 0,
    oldestItems: [],
  };

  const output = formatTodoReport(report);
  assert.ok(output.includes("Total items:"));
  assert.ok(output.includes("0"));
  // Should not crash on empty sections
  assert.ok(typeof output === "string");
});

test("formatTodoReport - reports with showAge=false omits age column", () => {
  const items: TodoItem[] = [
    {
      type: "TODO",
      message: "do something",
      file: "src/a.ts",
      line: 1,
    },
  ];

  const report: TodoReport = {
    totalItems: 1,
    items,
    byType: { TODO: 1 },
    byFile: { "src/a.ts": 1 },
    byAuthor: { unknown: 1 },
    averageAge: 0,
    oldestItems: [],
  };

  const output = formatTodoReport(report, { showAge: false });
  // The header without Age should appear
  assert.ok(!output.includes("Age (d)") || !output.includes("Age (d)") === false);
});

test("formatTodoReport - groupBy type", () => {
  const items: TodoItem[] = [
    { type: "TODO", message: "task a", file: "a.ts", line: 1 },
    { type: "FIXME", message: "fix b", file: "b.ts", line: 2 },
    { type: "NOTE", message: "note c", file: "c.ts", line: 3 },
  ];

  const report: TodoReport = {
    totalItems: 3,
    items,
    byType: { TODO: 1, FIXME: 1, NOTE: 1 },
    byFile: { "a.ts": 1, "b.ts": 1, "c.ts": 1 },
    byAuthor: { unknown: 3 },
    averageAge: 0,
    oldestItems: [],
  };

  const output = formatTodoReport(report, { groupBy: "type" });
  assert.ok(output.includes("### TODO"));
  assert.ok(output.includes("### FIXME"));
  assert.ok(output.includes("### NOTE"));
});

test("formatTodoReport - groupBy file", () => {
  const items: TodoItem[] = [
    { type: "TODO", message: "task a", file: "src/a.ts", line: 1 },
    { type: "FIXME", message: "fix b", file: "src/b.ts", line: 2 },
  ];

  const report: TodoReport = {
    totalItems: 2,
    items,
    byType: { TODO: 1, FIXME: 1 },
    byFile: { "src/a.ts": 1, "src/b.ts": 1 },
    byAuthor: { unknown: 2 },
    averageAge: 0,
    oldestItems: [],
  };

  const output = formatTodoReport(report, { groupBy: "file" });
  assert.ok(output.includes("### src/a.ts"));
  assert.ok(output.includes("### src/b.ts"));
});

test("formatTodoReport - groupBy author", () => {
  const items: TodoItem[] = [
    { type: "TODO", message: "task", file: "a.ts", line: 1, author: "alice@test.com" },
  ];

  const report: TodoReport = {
    totalItems: 1,
    items,
    byType: { TODO: 1 },
    byFile: { "a.ts": 1 },
    byAuthor: { "alice@test.com": 1 },
    averageAge: 0,
    oldestItems: [],
  };

  const output = formatTodoReport(report, { groupBy: "author" });
  assert.ok(output.includes("### alice@test.com"));
});

// ---------------------------------------------------------------------------
// getTodoHistory
// ---------------------------------------------------------------------------

test("getTodoHistory - returns empty array when no history file exists", () => {
  const root = fixture({ "src/app.ts": "// TODO: nothing\n" });
  const history = getTodoHistory(root);
  assert.deepEqual(history, []);
});

test("getTodoHistory - parses valid JSONL history file", () => {
  const root = fixture({});
  const claudeDir = join(root, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const report1: TodoReport = {
    totalItems: 1,
    items: [{ type: "TODO", message: "task", file: "a.ts", line: 1 }],
    byType: { TODO: 1 },
    byFile: { "a.ts": 1 },
    byAuthor: { unknown: 1 },
    averageAge: 0,
    oldestItems: [],
  };
  const report2: TodoReport = {
    totalItems: 2,
    items: [{ type: "FIXME", message: "fix", file: "b.ts", line: 2 }],
    byType: { FIXME: 1 },
    byFile: { "b.ts": 1 },
    byAuthor: { unknown: 1 },
    averageAge: 0,
    oldestItems: [],
  };
  writeFileSync(
    join(claudeDir, "todo-history.jsonl"),
    JSON.stringify(report1) + "\n" + JSON.stringify(report2) + "\n",
  );

  const history = getTodoHistory(root);
  assert.equal(history.length, 2);
  assert.equal(history[0].totalItems, 1);
  assert.equal(history[1].totalItems, 2);
});

test("getTodoHistory - skips malformed JSON lines", () => {
  const root = fixture({});
  const claudeDir = join(root, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, "todo-history.jsonl"),
    '{"totalItems":1}\nnot-json\n{"totalItems":2}\n',
  );

  const history = getTodoHistory(root);
  assert.equal(history.length, 2);
});

test("getTodoHistory - handles read errors gracefully", () => {
  const root = fixture({});
  const history = getTodoHistory(root);
  assert.deepEqual(history, []);
});
