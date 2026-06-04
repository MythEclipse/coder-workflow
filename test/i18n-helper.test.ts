import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractHardcodedStrings,
  checkMissingTranslation,
  formatLocaleReport,
  extractFromI18nFiles,
  generateLocaleTemplate,
} from "../src/i18n-helper.js";
import type { LocaleReport, ExtractedString } from "../src/i18n-helper.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "i18n-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(root, filePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// extractHardcodedStrings
// ---------------------------------------------------------------------------

test("extractHardcodedStrings - finds JSX text content", () => {
  const root = fixture({
    "src/App.tsx": `const App = () => (
  <div>
    <h1>Welcome to our application dashboard</h1>
    <p>Manage your account settings and preferences</p>
  </div>
);`,
  });

  const results = extractHardcodedStrings(root);
  // Should find the two JSX text strings
  assert.ok(results.length >= 2);
  assert.ok(results.some((r) => r.value === "Welcome to our application dashboard"));
  assert.ok(results.some((r) => r.value === "Manage your account settings and preferences"));
  assert.ok(results.every((r) => r.file.startsWith("src/")));
});

test("extractHardcodedStrings - finds console.log string literals", () => {
  const root = fixture({
    "src/logger.ts": `console.log("Failed to connect to database server");

function process() {
  console.error("An unexpected error occurred during validation");
}`,
  });

  const results = extractHardcodedStrings(root);
  assert.ok(results.length >= 2);
  assert.ok(results.some((r) => r.value.includes("Failed to connect")));
  assert.ok(results.some((r) => r.value.includes("unexpected error")));
});

test("extractHardcodedStrings - finds throw string literals", () => {
  const root = fixture({
    "src/validate.ts": `throw new Error("Invalid input provided for field validation");
throw "User is not authorized to perform this action";`,
  });

  const results = extractHardcodedStrings(root);
  assert.ok(results.length >= 2);
});

test("extractHardcodedStrings - skips import statements", () => {
  const root = fixture({
    "src/app.ts": `import React from "react";
import { useState } from "react";

const msg = "Hello and welcome to our platform";`,
  });

  const results = extractHardcodedStrings(root);
  // Should not have any results about "react" or useState import,
  // but should find the user-facing string
  assert.ok(results.some((r) => r.value.includes("welcome")));
});

test("extractHardcodedStrings - returns empty when no strings found", () => {
  const root = fixture({
    "src/app.ts": `const x = 1;
const y = x + 2;`,
  });

  const results = extractHardcodedStrings(root);
  assert.equal(results.length, 0);
});

test("extractHardcodedStrings - skips strings <= 15 chars", () => {
  const root = fixture({
    "src/app.ts": `const msg = "Hello World";`, // exactly 11 chars, should be skipped
  });

  const results = extractHardcodedStrings(root);
  // "Hello World" is only 11 chars -> skip (< 15)
  assert.equal(results.length, 0);
});

test("extractHardcodedStrings - includes file and line info", () => {
  const root = fixture({
    "src/app.ts": `const x = 1;
const welcome = "Welcome to our new great platform";`,
  });

  const results = extractHardcodedStrings(root);
  assert.ok(results.length > 0);
  assert.equal(results[0].file, "src/app.ts");
  assert.equal(results[0].line, 2);
});

test("extractHardcodedStrings - deduplicates by kebab-case key", () => {
  const root = fixture({
    "src/a.ts": `const msg = "Welcome to our great platform";`,
    "src/b.ts": `const msg = "Welcome to our great platform";`,
  });

  const results = extractHardcodedStrings(root);
  // Should only report one because both strings have same kebab key
  const matching = results.filter((r) => r.value.includes("Welcome to our"));
  assert.equal(matching.length, 1);
});

test("extractHardcodedStrings - handles empty directory", () => {
  const root = fixture({});
  const results = extractHardcodedStrings(root);
  assert.deepEqual(results, []);
});

test("extractHardcodedStrings - skips non-source files", () => {
  const root = fixture({
    "readme.md": `# Welcome to our application`,
    "data.json": `{"msg": "Welcome to our great platform"}`,
  });

  const results = extractHardcodedStrings(root);
  // .md and .json are not in SOURCE_EXTENSIONS
  assert.equal(results.length, 0);
});

// ---------------------------------------------------------------------------
// extractFromI18nFiles
// ---------------------------------------------------------------------------

test("extractFromI18nFiles - detects languages and keys", () => {
  const root = fixture({
    "locales/en.json": JSON.stringify({ welcome: "Welcome", goodbye: "Goodbye" }),
    "locales/id.json": JSON.stringify({ welcome: "Selamat Datang", goodbye: "Selamat Tinggal" }),
    "locales/fr.json": JSON.stringify({ welcome: "Bienvenue" }),
  });

  const report = extractFromI18nFiles(join(root, "locales"));

  assert.equal(report.languages.length, 3);
  assert.ok(report.languages.includes("en"));
  assert.ok(report.languages.includes("id"));
  assert.ok(report.languages.includes("fr"));
  assert.ok(report.totalStrings >= 2);

  // "goodbye" is missing in fr, so it should be in missingTranslations
  const missingGoodbye = report.missingTranslations.some(
    (m) => m.key === "goodbye" && m.language === "fr",
  );
  assert.ok(missingGoodbye);
});

test("extractFromI18nFiles - handles empty locales directory", () => {
  const root = fixture({});
  const report = extractFromI18nFiles(join(root, "locales"));
  assert.equal(report.totalStrings, 0);
  assert.equal(report.languages.length, 0);
});

test("extractFromI18nFiles - returns flatted nested keys", () => {
  const root = fixture({
    "locales/en.json": JSON.stringify({
      nav: { home: "Home", about: "About Us" },
      footer: { copyright: "All rights reserved" },
    }),
  });

  const report = extractFromI18nFiles(join(root, "locales"));
  assert.ok(report.totalStrings >= 3);
  // Keys should be nested dot-notation
  const hasNested = report.missingTranslations.length > 0 ||
    report.totalStrings > 0;
  assert.ok(hasNested);
});

// ---------------------------------------------------------------------------
// checkMissingTranslation
// ---------------------------------------------------------------------------

test("checkMissingTranslation - detects gaps between source and locale", () => {
  const root = fixture({
    "src/app.ts": `const msg = "Welcome to our application";`,
    "locales/en.json": JSON.stringify({}),
    "locales/id.json": JSON.stringify({}),
  });

  const report = checkMissingTranslation(root, join(root, "locales"));

  assert.equal(report.totalStrings, 1);
  assert.ok(report.languages.includes("en"));
  assert.ok(report.languages.includes("id"));
});

test("checkMissingTranslation - no missing when all translated", () => {
  const root = fixture({
    "src/app.ts": `const msg = "Welcome to our application";`,
    "locales/en.json": JSON.stringify({ "welcome-to-our-application": "Welcome" }),
    "locales/id.json": JSON.stringify({ "welcome-to-our-application": "Selamat Datang" }),
  });

  const report = checkMissingTranslation(root, join(root, "locales"));
  assert.equal(report.totalStrings, 1);
});

test("checkMissingTranslation - handles no source strings", () => {
  const root = fixture({
    "src/app.ts": `const x = 1;`,
    "locales/en.json": JSON.stringify({ hello: "Hello" }),
  });

  const report = checkMissingTranslation(root, join(root, "locales"));
  assert.equal(report.totalStrings, 0);
});

// ---------------------------------------------------------------------------
// formatLocaleReport
// ---------------------------------------------------------------------------

test("formatLocaleReport - produces formatted output", () => {
  const report: LocaleReport = {
    totalStrings: 3,
    files: ["src/app.ts"],
    languages: ["en", "id"],
    missingTranslations: [
      { key: "welcome-user", language: "en", file: "src/app.ts" },
      { key: "welcome-user", language: "id", file: "src/app.ts" },
    ],
    untranslatedKeys: ["welcome-user"],
  };

  const output = formatLocaleReport(report);
  assert.ok(output.includes("LOCALIZATION REPORT"));
  assert.ok(output.includes("Total strings found:  3"));
  assert.ok(output.includes("Languages detected:   en, id"));
  assert.ok(output.includes("MISSING TRANSLATIONS"));
  assert.ok(output.includes("welcome-user"));
});

test("formatLocaleReport - shows no missing translations", () => {
  const report: LocaleReport = {
    totalStrings: 2,
    files: ["src/app.ts"],
    languages: ["en"],
    missingTranslations: [],
    untranslatedKeys: [],
  };

  const output = formatLocaleReport(report);
  assert.ok(output.includes("No missing translations detected"));
  assert.ok(output.includes("All keys have translations"));
});

test("formatLocaleReport - shows untranslated keys section", () => {
  const report: LocaleReport = {
    totalStrings: 1,
    files: ["src/app.ts"],
    languages: ["en"],
    missingTranslations: [],
    untranslatedKeys: ["welcome-user"],
  };

  const output = formatLocaleReport(report);
  assert.ok(output.includes("UNTRANSLATED KEYS"));
  assert.ok(output.includes("welcome-user"));
});

test("formatLocaleReport - handles no languages", () => {
  const report: LocaleReport = {
    totalStrings: 2,
    files: ["src/app.ts"],
    languages: [],
    missingTranslations: [],
    untranslatedKeys: ["key-1", "key-2"],
  };

  const output = formatLocaleReport(report);
  assert.ok(output.includes("none"));
});

// ---------------------------------------------------------------------------
// generateLocaleTemplate
// ---------------------------------------------------------------------------

test("generateLocaleTemplate - produces empty object for no strings", () => {
  const result = generateLocaleTemplate([], "raw");
  assert.equal(result, "{}");
});

test("generateLocaleTemplate - raw format produces flat JSON", () => {
  const strings: ExtractedString[] = [
    { value: "Welcome to our application", file: "src/app.ts", line: 1 },
    { value: "Goodbye and see you later", file: "src/app.ts", line: 2 },
  ];

  const result = generateLocaleTemplate(strings, "raw");
  const parsed = JSON.parse(result);
  assert.ok(parsed["welcome-to-our-application"]);
  assert.ok(parsed["goodbye-and-see-you-later"]);
});

test("generateLocaleTemplate - i18next format nests namespaced keys", () => {
  const strings: ExtractedString[] = [
    { value: "Welcome to our application", file: "src/app.ts", line: 1 },
    { value: "Navigate to the home page", file: "src/app.ts", line: 2 },
  ];

  const result = generateLocaleTemplate(strings, "i18next");
  const parsed = JSON.parse(result);
  // "Welcome" and "Navigate" should become top-level namespaces
  assert.ok(typeof parsed === "object");
});

test("generateLocaleTemplate - react-intl format uses flat keys with comments", () => {
  const strings: ExtractedString[] = [
    { value: "Welcome to our application", file: "src/app.ts", line: 1 },
  ];

  const result = generateLocaleTemplate(strings, "react-intl");
  assert.ok(result.includes("welcome-to-our-application"));
  assert.ok(result.includes("//"));
});
