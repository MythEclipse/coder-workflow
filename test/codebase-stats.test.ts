import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodebaseStats, StatsHistory } from "../src/codebase-stats.js";
import {
  analyzeLanguages,
  compareStats,
  countLinesInFile,
  formatStats,
  formatStatsHistory,
  generateStats,
} from "../src/codebase-stats.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codebase-stats-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(root, filePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// countLinesInFile
// ---------------------------------------------------------------------------

test("countLinesInFile - counts lines and bytes", () => {
  const root = fixture({ "test.ts": "line1\nline2\nline3\n" });
  const result = countLinesInFile(join(root, "test.ts"));
  // split("\n").length on "line1\nline2\nline3\n" gives 4 (3 lines + trailing empty)
  assert.equal(result.lines, 4);
  assert.ok(result.bytes > 0);
});

test("countLinesInFile - returns zeros for unreadable files", () => {
  const result = countLinesInFile("/nonexistent/path/file.ts");
  assert.equal(result.lines, 0);
  assert.equal(result.bytes, 0);
});

test("countLinesInFile - handles empty file", () => {
  const root = fixture({ "empty.ts": "" });
  const result = countLinesInFile(join(root, "empty.ts"));
  assert.equal(result.lines, 0);
  assert.equal(result.bytes, 0);
});

// ---------------------------------------------------------------------------
// analyzeLanguages
// ---------------------------------------------------------------------------

test("analyzeLanguages - detects languages by extension", () => {
  const root = fixture({
    "src/app.ts": "console.log('hello');\n",
    "src/style.css": "body { color: red; }\n",
    "src/data.json": '{"key": "value"}\n',
  });

  const languages = analyzeLanguages(root);
  assert.equal(languages.length, 3);

  const ts = languages.find((l) => l.name === "TypeScript");
  assert.ok(ts);
  assert.equal(ts.files, 1);
  assert.ok(ts.lines > 0);

  const css = languages.find((l) => l.name === "CSS");
  assert.ok(css);
  assert.equal(css.files, 1);

  const json = languages.find((l) => l.name === "JSON");
  assert.ok(json);
  assert.equal(json.files, 1);
});

test("analyzeLanguages - skips default excluded directories", () => {
  const root = fixture({
    "src/app.ts": "const x = 1;\n",
    "node_modules/pkg/index.js": "module.exports = {};\n",
    "dist/bundle.js": "console.log(1);\n",
    ".git/config": "[core]\n",
  });

  const languages = analyzeLanguages(root);
  // Should only find the src/app.ts file
  assert.equal(languages.length, 1);
  assert.equal(languages[0].name, "TypeScript");
});

test("analyzeLanguages - respects custom exclude patterns", () => {
  const root = fixture({
    "src/app.ts": "const x = 1;\n",
    "vendor/lib.ts": "function f() {}\n",
  });

  const languages = analyzeLanguages(root, { exclude: ["vendor"] });
  assert.equal(languages.length, 1);
  assert.equal(languages[0].name, "TypeScript");
});

test("analyzeLanguages - handles empty directory", () => {
  const root = fixture({});
  const languages = analyzeLanguages(root);
  assert.deepEqual(languages, []);
});

test("analyzeLanguages - handles only unknown extensions", () => {
  const root = fixture({
    "file.xyz": "content",
    "other.abc": "more",
  });
  const languages = analyzeLanguages(root);
  assert.deepEqual(languages, []);
});

// ---------------------------------------------------------------------------
// generateStats
// ---------------------------------------------------------------------------

test("generateStats - produces complete stats object", () => {
  const root = fixture({
    "src/app.ts": "const x = 1;\nconst y = 2;\n",
    "src/utils.ts": "export function hello() {\n  return 'world';\n}\n",
    "package.json": JSON.stringify({
      dependencies: { react: "^18.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    }),
  });

  const stats = generateStats(root);

  assert.equal(stats.totalFiles, 3); // 2 .ts + 1 .json
  assert.ok(stats.totalLines > 0);
  assert.ok(stats.totalBytes > 0);
  assert.equal(stats.languages.length, 2); // TypeScript + JSON

  const ts = stats.languages.find((l) => l.name === "TypeScript");
  assert.ok(ts);
  assert.equal(ts.files, 2);

  const json = stats.languages.find((l) => l.name === "JSON");
  assert.ok(json);
  assert.equal(json.files, 1);

  assert.equal(stats.dependencies.length, 1);
  assert.equal(stats.dependencies[0].name, "react");
  assert.equal(stats.devDependencies.length, 1);
  assert.equal(stats.devDependencies[0].name, "typescript");

  assert.ok(stats.generatedAt);
});

test("generateStats - handles directory with no package.json", () => {
  const root = fixture({
    "src/app.ts": "const x = 1;\n",
  });

  const stats = generateStats(root);
  assert.equal(stats.dependencies.length, 0);
  assert.equal(stats.devDependencies.length, 0);
});

test("generateStats - handles empty directory", () => {
  const root = fixture({});
  const stats = generateStats(root);
  assert.equal(stats.totalFiles, 0);
  assert.equal(stats.totalLines, 0);
  assert.equal(stats.totalBytes, 0);
  assert.equal(stats.languages.length, 0);
  assert.ok(stats.generatedAt);
});

test("generateStats - handles single file", () => {
  const root = fixture({
    "single.ts": "export const hello = 'world';\n",
  });

  const stats = generateStats(root);
  assert.equal(stats.totalFiles, 1);
  assert.equal(stats.languages.length, 1);
  assert.equal(stats.languages[0].name, "TypeScript");
  assert.equal(stats.languages[0].files, 1);
  assert.ok(stats.languages[0].lines > 0);
  assert.equal(stats.languages[0].percent, 100);
});

// ---------------------------------------------------------------------------
// formatStats
// ---------------------------------------------------------------------------

test("formatStats - produces formatted output with all sections", () => {
  const stats: CodebaseStats = {
    totalFiles: 5,
    totalLines: 200,
    totalBytes: 10240,
    languages: [
      { name: "TypeScript", files: 3, lines: 150, bytes: 5120, percent: 75 },
      { name: "CSS", files: 2, lines: 50, bytes: 5120, percent: 25 },
    ],
    dependencies: [
      { name: "react", version: "^18.0.0", type: "dependencies" },
      { name: "express", version: "^4.0.0", type: "dependencies" },
    ],
    devDependencies: [{ name: "typescript", version: "^5.0.0", type: "devDependencies" }],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatStats(stats);
  assert.ok(output.includes("Codebase Statistics"));
  assert.ok(output.includes("Total Files:  5"));
  assert.ok(output.includes("Total Lines:  200"));
  assert.ok(output.includes("Language Breakdown"));
  assert.ok(output.includes("TypeScript"));
  assert.ok(output.includes("CSS"));
  assert.ok(output.includes("react"));
  assert.ok(output.includes("express"));
  assert.ok(output.includes("typescript"));
  assert.ok(output.includes("Top Dependencies"));
  assert.ok(output.includes("Top Dev Dependencies"));
});

test("formatStats - handles empty stats", () => {
  const stats: CodebaseStats = {
    totalFiles: 0,
    totalLines: 0,
    totalBytes: 0,
    languages: [],
    dependencies: [],
    devDependencies: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatStats(stats);
  assert.ok(output.includes("Codebase Statistics"));
  assert.ok(output.includes("Total Files:  0"));
});

test("formatStats - handles no dependencies", () => {
  const stats: CodebaseStats = {
    totalFiles: 1,
    totalLines: 10,
    totalBytes: 100,
    languages: [{ name: "TypeScript", files: 1, lines: 10, bytes: 100, percent: 100 }],
    dependencies: [],
    devDependencies: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatStats(stats);
  assert.ok(output.includes("Dependencies: 0"));
  assert.ok(output.includes("Dev Deps:     0"));
});

test("formatStats - truncates long dependency lists", () => {
  const deps = Array.from({ length: 20 }, (_, i) => ({
    name: `pkg-${i}`,
    version: "1.0.0",
    type: "dependencies" as const,
  }));

  const stats: CodebaseStats = {
    totalFiles: 1,
    totalLines: 10,
    totalBytes: 100,
    languages: [{ name: "TypeScript", files: 1, lines: 10, bytes: 100, percent: 100 }],
    dependencies: deps,
    devDependencies: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatStats(stats);
  assert.ok(output.includes("... and 5 more")); // 20 total - 15 shown = 5 more
});

// ---------------------------------------------------------------------------
// compareStats
// ---------------------------------------------------------------------------

test("compareStats - detects lines and files differences", () => {
  const before: CodebaseStats = {
    totalFiles: 10,
    totalLines: 500,
    totalBytes: 25000,
    languages: [
      { name: "TypeScript", files: 5, lines: 300, bytes: 15000, percent: 60 },
      { name: "CSS", files: 5, lines: 200, bytes: 10000, percent: 40 },
    ],
    dependencies: [{ name: "react", version: "^18.0.0", type: "dependencies" }],
    devDependencies: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const after: CodebaseStats = {
    totalFiles: 12,
    totalLines: 600,
    totalBytes: 30000,
    languages: [
      { name: "TypeScript", files: 7, lines: 400, bytes: 20000, percent: 67 },
      { name: "CSS", files: 5, lines: 200, bytes: 10000, percent: 33 },
    ],
    dependencies: [
      { name: "react", version: "^18.0.0", type: "dependencies" },
      { name: "lodash", version: "^4.0.0", type: "dependencies" },
    ],
    devDependencies: [],
    generatedAt: "2026-01-02T00:00:00.000Z",
  };

  const result = compareStats(before, after);
  assert.equal(result.linesDiff, 100);
  assert.equal(result.filesDiff, 2);
  assert.deepEqual(result.depsAdded, ["lodash"]);
  assert.deepEqual(result.depsRemoved, []);
});

test("compareStats - detects removed deps and language changes", () => {
  const before: CodebaseStats = {
    totalFiles: 5,
    totalLines: 300,
    totalBytes: 15000,
    languages: [{ name: "TypeScript", files: 5, lines: 300, bytes: 15000, percent: 100 }],
    dependencies: [{ name: "old-pkg", version: "^1.0.0", type: "dependencies" }],
    devDependencies: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const after: CodebaseStats = {
    totalFiles: 5,
    totalLines: 350,
    totalBytes: 17000,
    languages: [{ name: "TypeScript", files: 5, lines: 350, bytes: 17000, percent: 100 }],
    dependencies: [],
    devDependencies: [],
    generatedAt: "2026-01-02T00:00:00.000Z",
  };

  const result = compareStats(before, after);
  assert.equal(result.linesDiff, 50);
  assert.equal(result.filesDiff, 0);
  assert.deepEqual(result.depsRemoved, ["old-pkg"]);
  assert.equal(result.languageChanges.length, 1);
  assert.equal(result.languageChanges[0].name, "TypeScript");
  assert.equal(result.languageChanges[0].change, 50);
});

test("compareStats - handles identical stats", () => {
  const stats: CodebaseStats = {
    totalFiles: 3,
    totalLines: 100,
    totalBytes: 5000,
    languages: [{ name: "TypeScript", files: 3, lines: 100, bytes: 5000, percent: 100 }],
    dependencies: [],
    devDependencies: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const result = compareStats(stats, stats);
  assert.equal(result.linesDiff, 0);
  assert.equal(result.filesDiff, 0);
  assert.deepEqual(result.depsAdded, []);
  assert.deepEqual(result.depsRemoved, []);
  assert.deepEqual(result.languageChanges, []);
});

// ---------------------------------------------------------------------------
// formatStatsHistory
// ---------------------------------------------------------------------------

test("formatStatsHistory - produces formatted output with snapshots", () => {
  const history: StatsHistory = {
    reports: [
      {
        totalFiles: 5,
        totalLines: 200,
        totalBytes: 10000,
        languages: [{ name: "TypeScript", files: 5, lines: 200, bytes: 10000, percent: 100 }],
        dependencies: [],
        devDependencies: [],
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        totalFiles: 8,
        totalLines: 350,
        totalBytes: 20000,
        languages: [{ name: "TypeScript", files: 8, lines: 350, bytes: 20000, percent: 100 }],
        dependencies: [{ name: "react", version: "^18.0.0", type: "dependencies" }],
        devDependencies: [],
        generatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    dates: ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"],
    trends: {
      lines: [
        { date: "2026-01-01T00:00:00.000Z", value: 200 },
        { date: "2026-01-02T00:00:00.000Z", value: 350 },
      ],
      files: [
        { date: "2026-01-01T00:00:00.000Z", value: 5 },
        { date: "2026-01-02T00:00:00.000Z", value: 8 },
      ],
      deps: [
        { date: "2026-01-01T00:00:00.000Z", value: 0 },
        { date: "2026-01-02T00:00:00.000Z", value: 1 },
      ],
    },
  };

  const output = formatStatsHistory(history);
  assert.ok(output.includes("Stats History"));
  assert.ok(output.includes("Snapshots: 2"));
  assert.ok(output.includes("Trends (overall change)"));
  assert.ok(output.includes("200"));
  assert.ok(output.includes("350"));
  assert.ok(output.includes("+150")); // lines diff: 350-200 = +150
  assert.ok(output.includes("+3")); // files diff: 8-5 = +3
  assert.ok(output.includes("Snapshot History"));
});

test("formatStatsHistory - handles single snapshot", () => {
  const history: StatsHistory = {
    reports: [
      {
        totalFiles: 1,
        totalLines: 10,
        totalBytes: 100,
        languages: [{ name: "TypeScript", files: 1, lines: 10, bytes: 100, percent: 100 }],
        dependencies: [],
        devDependencies: [],
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    dates: ["2026-01-01T00:00:00.000Z"],
    trends: {
      lines: [{ date: "2026-01-01T00:00:00.000Z", value: 10 }],
      files: [{ date: "2026-01-01T00:00:00.000Z", value: 1 }],
      deps: [{ date: "2026-01-01T00:00:00.000Z", value: 0 }],
    },
  };

  const output = formatStatsHistory(history);
  assert.ok(output.includes("Stats History"));
  assert.ok(output.includes("Snapshots: 1"));
});

test("formatStatsHistory - handles empty history", () => {
  const history: StatsHistory = {
    reports: [],
    dates: [],
    trends: { lines: [], files: [], deps: [] },
  };

  const output = formatStatsHistory(history);
  assert.ok(output.includes("No stats history found"));
});
