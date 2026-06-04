import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatChangelogMarkdown } from "../src/release.js";
import type { ChangelogEntry } from "../src/release.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-release-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("formatChangelogMarkdown renders empty entries (no sections)", () => {
  const entries: ChangelogEntry[] = [
    { version: "1.0.0", date: "2024-01-15", features: [], fixes: [], chores: [], breaking: [], refactors: [] },
  ];

  const output = formatChangelogMarkdown(entries);

  assert.match(output, /# Changelog/);
  assert.match(output, /## 1\.0\.0 — 2024-01-15/);
  // Should NOT have any section headers since all arrays are empty
  assert.ok(!output.includes("Features"), "should not have Features header when empty");
  assert.ok(!output.includes("Bug Fixes"), "should not have Bug Fixes header when empty");
  assert.ok(!output.includes("Breaking Changes"), "should not have Breaking header when empty");
});

test("formatChangelogMarkdown renders single entry with all sections", () => {
  const entries: ChangelogEntry[] = [
    {
      version: "2.0.0",
      date: "2024-06-01",
      features: ["Add user authentication", "Add dark mode"],
      fixes: ["Fix login crash"],
      chores: ["Update dependencies"],
      breaking: ["Drop Node 16 support"],
      refactors: ["Rewrite API layer"],
    },
  ];

  const output = formatChangelogMarkdown(entries);

  assert.match(output, /# Changelog/);
  assert.match(output, /## 2\.0\.0 — 2024-06-01/);
  assert.match(output, /🚀 Features/);
  assert.match(output, /Add user authentication/);
  assert.match(output, /Add dark mode/);
  assert.match(output, /🐛 Bug Fixes/);
  assert.match(output, /Fix login crash/);
  assert.match(output, /⚠️ Breaking Changes/);
  assert.match(output, /Drop Node 16 support/);
  assert.match(output, /♻️ Refactors/);
  assert.match(output, /Rewrite API layer/);
  assert.match(output, /📦 Maintenance/);
  assert.match(output, /Update dependencies/);
});

test("formatChangelogMarkdown renders multiple entries", () => {
  const entries: ChangelogEntry[] = [
    {
      version: "1.1.0",
      date: "2024-03-01",
      features: ["New feature"],
      fixes: [],
      chores: [],
      breaking: [],
      refactors: [],
    },
    {
      version: "1.0.0",
      date: "2024-01-15",
      features: [],
      fixes: ["Initial fix"],
      chores: ["Setup CI"],
      breaking: [],
      refactors: [],
    },
  ];

  const output = formatChangelogMarkdown(entries);

  assert.match(output, /## 1\.1\.0 — 2024-03-01/);
  assert.match(output, /## 1\.0\.0 — 2024-01-15/);

  // First entry has only features
  const firstSection = output.split("## 1.0.0")[0];
  assert.ok(firstSection.includes("New feature"), "first entry should have feature");

  // Second entry has fixes and chores
  const secondSection = output.split("## 1.0.0")[1];
  assert.ok(secondSection.includes("Initial fix"), "second entry should have fix");
  assert.ok(secondSection.includes("Setup CI"), "second entry should have chore");
});

test("formatChangelogMarkdown sanitizes list items with leading dashes", () => {
  const entries: ChangelogEntry[] = [
    {
      version: "1.0.0",
      date: "2024-01-15",
      features: ["feat(core): add new endpoint"],
      fixes: ["fix(auth): null pointer"],
      chores: [],
      breaking: [],
      refactors: [],
    },
  ];

  const output = formatChangelogMarkdown(entries);

  // Each feature/fix line should start with `- ` (the function adds the list prefix)
  assert.match(output, /- feat\(core\): add new endpoint/);
  assert.match(output, /- fix\(auth\): null pointer/);
});

test("formatChangelogMarkdown handles entries with only breaking changes", () => {
  const entries: ChangelogEntry[] = [
    {
      version: "3.0.0",
      date: "2024-12-01",
      features: [],
      fixes: [],
      chores: [],
      breaking: ["Complete API redesign", "Database migration required"],
      refactors: [],
    },
  ];

  const output = formatChangelogMarkdown(entries);

  assert.match(output, /⚠️ Breaking Changes/);
  assert.match(output, /Complete API redesign/);
  assert.match(output, /Database migration required/);
  assert.ok(!output.includes("🚀 Features"));
  assert.ok(!output.includes("🐛 Bug Fixes"));
});

test("formatChangelogMarkdown handles entries with only refactors", () => {
  const entries: ChangelogEntry[] = [
    {
      version: "1.5.0",
      date: "2024-09-15",
      features: [],
      fixes: [],
      chores: [],
      breaking: [],
      refactors: ["Extract service layer", "Rename controllers"],
    },
  ];

  const output = formatChangelogMarkdown(entries);

  assert.match(output, /♻️ Refactors/);
  assert.match(output, /Extract service layer/);
  assert.match(output, /Rename controllers/);
  assert.ok(!output.includes("⚠️ Breaking Changes"));
  assert.ok(!output.includes("📦 Maintenance"));
});

test("formatChangelogMarkdown returns valid markdown for empty entries list", () => {
  const output = formatChangelogMarkdown([]);

  assert.equal(output, "# Changelog\n");
});

test("ChangelogEntry type structural contract", () => {
  // Create a changelog entry meeting the type contract
  const entry: ChangelogEntry = {
    version: "1.0.0",
    date: "2024-01-01",
    features: ["feat1"],
    fixes: ["fix1"],
    chores: ["chore1"],
    breaking: ["breaking1"],
    refactors: ["refactor1"],
  };

  assert.equal(entry.version, "1.0.0");
  assert.equal(entry.date, "2024-01-01");
  assert.ok(Array.isArray(entry.features));
  assert.ok(Array.isArray(entry.fixes));
  assert.ok(Array.isArray(entry.chores));
  assert.ok(Array.isArray(entry.breaking));
  assert.ok(Array.isArray(entry.refactors));
});

test("createRelease and generatePRDescription functions exist as exports", async () => {
  const mod = await import("../src/release.js");

  assert.equal(typeof mod.createRelease, "function");
  assert.equal(typeof mod.generatePRDescription, "function");
  assert.equal(typeof mod.generateChangelog, "function");
});

test("formatChangelogMarkdown handles special characters in entry content", () => {
  const entries: ChangelogEntry[] = [
    {
      version: "1.0.0",
      date: "2024-01-01",
      features: ["Support `codeBlock` syntax", "Handle <angle>brackets</angle>"],
      fixes: [],
      chores: [],
      breaking: [],
      refactors: [],
    },
  ];

  const output = formatChangelogMarkdown(entries);

  assert.match(output, /codeBlock/);
  assert.match(output, /angle.*brackets/);
});

test("formatChangelogMarkdown preserves entry ordering in output", () => {
  const entries: ChangelogEntry[] = [
    {
      version: "3.0.0", date: "2024-03-01",
      features: ["Feature A"], fixes: [], chores: [], breaking: [], refactors: [],
    },
    {
      version: "2.0.0", date: "2024-02-01",
      features: ["Feature B"], fixes: [], chores: [], breaking: [], refactors: [],
    },
    {
      version: "1.0.0", date: "2024-01-01",
      features: ["Feature C"], fixes: [], chores: [], breaking: [], refactors: [],
    },
  ];

  const output = formatChangelogMarkdown(entries);

  const v3Idx = output.indexOf("3.0.0");
  const v2Idx = output.indexOf("2.0.0");
  const v1Idx = output.indexOf("1.0.0");

  assert.ok(v3Idx < v2Idx, "version 3.0.0 should appear before 2.0.0");
  assert.ok(v2Idx < v1Idx, "version 2.0.0 should appear before 1.0.0");
});
