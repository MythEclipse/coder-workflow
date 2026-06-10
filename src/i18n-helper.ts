import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedString {
  value: string;
  file: string;
  line: number;
  context?: string;
}

export interface LocaleEntry {
  key: string;
  source: string;
  translations: Record<string, string>;
}

export interface LocaleReport {
  totalStrings: number;
  files: string[];
  languages: string[];
  missingTranslations: Array<{
    key: string;
    language: string;
    file: string;
  }>;
  untranslatedKeys: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUPPORTED_FORMATS = ["i18next", "react-intl", "vue-i18n", "raw"] as const;

export type LocaleFormat = (typeof SUPPORTED_FORMATS)[number];

// ---------------------------------------------------------------------------
// Compile-time constants for scanning
// ---------------------------------------------------------------------------

/** Files / dirs always excluded from source scanning. */
const SCAN_EXCLUDE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".codegraph",
  "coverage",
  ".claude",
]);

/** File extensions considered as source files. */
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
]);

/** Matches quoted strings that look like user-facing text.
 *  - Opening quote (single, double, backtick)
 *  - Content: starts with uppercase letter, 10+ chars of readable text
 *  - Closing same quote
 */
const USER_FACING_STRING_RE = /(["'`])([A-Z][a-zA-Z\s,;:!?']{10,})\1/g;

/** Common patterns that should never be treated as i18n strings. */
const SKIP_PATTERNS: RegExp[] = [
  /^import\s/, // import statements
  /^(from|require)\s/, // require / from
  /^https?:\/\//, // URLs
  /^\/\//, // protocol-relative URLs
  /^[./]/, // relative paths
  /\.[a-z]{2,4}$/i, // file extensions (e.g. ".json", ".ts")
  /^@[a-z0-9-]+\//, // npm scoped package names
  /^[a-z0-9-]+\/[a-z0-9-]+/, // package names with scope
  /^node:/, // node: builtins
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/, // HTTP methods
  /^[a-z_$][a-z0-9_$]*$/i, // identifiers / variable names
  /^[A-Z][A-Z_0-9]+$/, // CONSTANT_CASE
  /^\d/, // starting with digit
  /^[a-z][a-z0-9]+$/i, // single-word lowercase identifiers
  /^(TODO|FIXME|HACK|XXX|WORKAROUND):/i, // code annotations
  /^[<>]/, // JSX fragments
  /^['"`]/, // already-quoted leftovers
];

// ---------------------------------------------------------------------------
// String → kebab-case key
// ---------------------------------------------------------------------------

function toKebabCaseKey(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, "") // strip punctuation except hyphens
    .replace(/\s+/g, "-") // spaces → hyphens
    .replace(/-+/g, "-") // collapse hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

function isSourceExtension(file: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(file));
}

function shouldSkipString(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= 15) return true;
  // Skip if it matches any exclusion pattern
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function collectSourceFiles(root: string, excludePatterns?: string[]): string[] {
  const files: string[] = [];
  const patterns = excludePatterns ?? [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (SCAN_EXCLUDE.has(entry)) continue;
        walk(fullPath);
      } else if (stat.isFile() && isSourceExtension(entry)) {
        files.push(fullPath);
      }
    }
  }

  walk(resolve(root));

  // Apply custom exclude globs (simple substring / forward-match)
  if (patterns.length > 0) {
    return files.filter((f) => !patterns.some((p) => f.includes(p)));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan source files for hardcoded user-facing strings.
 *
 * Detects:
 * - JSX text content between tags (outside `<code>`)
 * - `console.log` / `console.message` / `throw` string literals
 * - Any quoted string > 15 chars that starts with a capital letter
 *   and looks like readable text
 */
export function extractHardcodedStrings(
  root: string,
  options?: { excludePatterns?: string[] },
): ExtractedString[] {
  const results: ExtractedString[] = [];
  const seen = new Set<string>();
  const files = collectSourceFiles(root, options?.excludePatterns);

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;

      // --- JSX text content outside `<code>` tags ---
      // Match text between `>` and `<` on JSX lines (excluding <code> blocks)
      // This is a best-effort heuristic, not a full JSX parser.
      if (isJSXLine(line) && !isInsideCodeBlock(line, lines, idx)) {
        const jsxTexts = extractJSXText(line);
        for (const text of jsxTexts) {
          if (!shouldSkipString(text)) {
            const key = toKebabCaseKey(text);
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({
              value: text.trim(),
              file: relative(root, file).replace(/\\/g, "/"),
              line: lineNum,
              context: line.trim().slice(0, 120),
            });
          }
        }
      }

      // --- console.log / console.message / throw string literals ---
      const consoleOrThrowRE =
        /(?:console\.(?:log|message|warn|error|info|debug)|throw)\s*\(?\s*(["'`])([A-Z][\s\S]*?)\1/;
      const consoleMatch = line.match(consoleOrThrowRE);
      if (consoleMatch) {
        const text = consoleMatch[2];
        if (!shouldSkipString(text)) {
          const key = toKebabCaseKey(text);
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            value: text.trim(),
            file: relative(root, file).replace(/\\/g, "/"),
            line: lineNum,
            context: line.trim().slice(0, 120),
          });
        }
      }

      // --- Generic regex for capitalized readable strings ---
      USER_FACING_STRING_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = USER_FACING_STRING_RE.exec(line)) !== null) {
        const text = match[2];
        // Skip if this match was already caught by JSX or console detection
        if (consoleOrThrowRE.test(line)) continue;

        if (!shouldSkipString(text)) {
          const key = toKebabCaseKey(text);
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            value: text.trim(),
            file: relative(root, file).replace(/\\/g, "/"),
            line: lineNum,
            context: line.trim().slice(0, 120),
          });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// JSX heuristics
// ---------------------------------------------------------------------------

/** Rough heuristic: a line likely contains JSX. */
function isJSXLine(line: string): boolean {
  return /<\/?[A-Z][a-zA-Z]*\b/.test(line) || />[\s\S]*<\//.test(line);
}

/** Check whether we are inside a `<code>` block by scanning surrounding lines. */
function isInsideCodeBlock(line: string, _lines: string[], _idx: number): boolean {
  // If the line itself is a <code> tag, treat as inside
  if (/<code[\s>]/.test(line) || /<\/code>/.test(line)) return true;

  // Simple heuristic: scan back a few lines for an opening <code>
  // without a corresponding closing tag before this line.
  // Because this is a limited scan we only look at local context.
  const windowStart = Math.max(0, _idx - 10);
  let codeOpened = false;
  for (let i = windowStart; i < _idx; i++) {
    if (/<code[\s>]/.test(_lines[i])) codeOpened = true;
    if (/<\/code>/.test(_lines[i])) codeOpened = false;
  }
  return codeOpened;
}

/** Extract text content between `>` and `<` on a single line (JSX). */
function extractJSXText(line: string): string[] {
  const texts: string[] = [];
  // Match `>text<` where text is between closing and opening tags
  const tagContentRE = />([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = tagContentRE.exec(line)) !== null) {
    const text = m[1].trim();
    if (text.length > 0) {
      texts.push(text);
    }
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Locale file parsing
// ---------------------------------------------------------------------------

/** Supported locale file extensions and their loaders. */
function loadLocaleFile(filePath: string): Record<string, string> {
  const ext = extname(filePath);
  const raw = readFileSync(filePath, "utf-8");

  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    return flattenObject(parsed);
  }

  if (ext === ".js" || ext === ".cjs") {
    // We cannot safely require() in an ESM context, but a simple
    // export detection can extract simple module.exports / export default
    return extractExportMap(raw);
  }

  if (ext === ".mjs") {
    return extractExportMap(raw);
  }

  throw new Error(`Unsupported locale file extension: ${ext}`);
}

/** Extract locale entries from a JS/TS file that exports a plain object. */
function extractExportMap(source: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Match `export default { ... }` or `module.exports = { ... }`
  // Simple heuristic: find the first object literal and parse its shallow keys.
  // For deeper nesting, fall back to JSON.parse of the object literal.
  const objStart = source.indexOf("{");
  const objEnd = source.lastIndexOf("}");
  if (objStart === -1 || objEnd === -1 || objEnd <= objStart) return result;

  const objBody = source.slice(objStart, objEnd + 1);

  // Hook into property definitions: "key": "value" or key: "value"
  const propRE = /["']?([a-zA-Z0-9_-]+)["']?\s*:\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = propRE.exec(objBody)) !== null) {
    result[m[1]] = m[2];
  }

  return result;
}

/** Flatten a nested object into dot-notation keys. */
function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Locale detection
// ---------------------------------------------------------------------------

interface DetectedLocaleFile {
  lang: string;
  path: string;
}

/** Detect locale files matching a pattern like `en.json`, `id.json`, `en-US.js`. */
function detectLocaleFiles(dir: string): DetectedLocaleFile[] {
  const dirPath = resolve(dir);
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  const files: DetectedLocaleFile[] = [];
  // Match e.g. en.json, id.json, en-US.js, zh-CN.cjs, fr.mjs
  const localeFileRE = /^([a-z]{2}(?:-[A-Z]{2})?)\.(json|js|cjs|mjs)$/;

  for (const entry of entries) {
    const m = entry.match(localeFileRE);
    if (m) {
      files.push({ lang: m[1], path: join(dirPath, entry) });
    }
  }

  return files.sort((a, b) => a.lang.localeCompare(b.lang));
}

// ---------------------------------------------------------------------------
// extractFromI18nFiles
// ---------------------------------------------------------------------------

/**
 * Read existing locale files from `localesDir` and return a report with
 * detected languages, keys, translations, and missing translations.
 */
export function extractFromI18nFiles(localesDir: string): LocaleReport {
  const localeFiles = detectLocaleFiles(localesDir);

  if (localeFiles.length === 0) {
    return {
      totalStrings: 0,
      files: [],
      languages: [],
      missingTranslations: [],
      untranslatedKeys: [],
    };
  }

  // Load each locale file into a lang → { key → translation } map
  const localeData: Record<string, Record<string, string>> = {};
  for (const lf of localeFiles) {
    try {
      localeData[lf.lang] = loadLocaleFile(lf.path);
    } catch {}
  }

  const languages = Object.keys(localeData).sort();
  if (languages.length === 0) {
    return {
      totalStrings: 0,
      files: localeFiles.map((f) => f.path),
      languages: [],
      missingTranslations: [],
      untranslatedKeys: [],
    };
  }

  // Collect all unique keys across all locale files
  const allKeys = new Set<string>();
  for (const data of Object.values(localeData)) {
    for (const key of Object.keys(data)) {
      allKeys.add(key);
    }
  }

  const keys = [...allKeys].sort();
  const missingTranslations: LocaleReport["missingTranslations"] = [];
  const untranslatedKeys: string[] = [];

  for (const key of keys) {
    let translatedCount = 0;
    for (const lang of languages) {
      const val = localeData[lang]?.[key];
      if (!val || val.trim().length === 0) {
        missingTranslations.push({ key, language: lang, file: "" });
      } else {
        translatedCount++;
      }
    }

    // A key is "untranslated" if it exists in fewer than half the locale files
    if (translatedCount < languages.length / 2) {
      untranslatedKeys.push(key);
    }
  }

  // Collect all unique files (paths)
  const files = localeFiles.map((f) => f.path);

  return {
    totalStrings: keys.length,
    files,
    languages,
    missingTranslations,
    untranslatedKeys,
  };
}

// ---------------------------------------------------------------------------
// generateLocaleTemplate
// ---------------------------------------------------------------------------

/**
 * Generate a locale JSON template from extracted strings.
 * - Keys are kebab-case derived from the extracted value.
 * - For `i18next` format, keys are nested under a root key structure.
 * - For `react-intl`, keys are flat.
 * - For `vue-i18n`, similar to i18next (nested by prefix).
 * - For `raw`, simple flat JSON.
 */
export function generateLocaleTemplate(extracted: ExtractedString[], format: LocaleFormat): string {
  if (extracted.length === 0) {
    return "{}";
  }

  // Deduplicate by kebab-case key
  const map = new Map<string, string>();
  for (const item of extracted) {
    const key = toKebabCaseKey(item.value);
    if (!map.has(key)) {
      map.set(key, item.value);
    }
  }

  const entries = [...map.entries()];
  const template: Record<string, string | Record<string, string>> = {};

  if (format === "i18next" || format === "vue-i18n") {
    // Group by first segment for namespacing
    const groups = groupByPrefix(entries);

    for (const [prefix, group] of Object.entries(groups)) {
      if (group.length === 1 && prefix === group[0][0]) {
        // Single flat entry
        template[prefix] = group[0][1];
      } else {
        const sub: Record<string, string> = {};
        for (const [key, val] of group) {
          const localKey = key.startsWith(`${prefix}.`) ? key.slice(prefix.length + 1) : key;
          sub[localKey] = val;
        }
        template[prefix] = sub;
      }
    }

    return JSON.stringify(template, null, 2);
  }

  if (format === "react-intl") {
    // Flat IDs with defaultMessage hint in comments.
    const lines: string[] = ["{"];
    for (const [key, val] of entries) {
      // Escape internal quotes in the comment
      const comment = val.replace(/"/g, "'");
      lines.push(`  // ${comment}`);
      lines.push(`  "${key}": ""`);
      lines.push(",");
    }
    // Remove trailing comma
    if (lines.length > 1) {
      lines.splice(lines.length - 1, 1);
    }
    lines.push("}");
    return lines.join("\n");
  }

  // raw format: flat JSON with original values as placeholders
  for (const [key, val] of entries) {
    template[key] = val;
  }

  return JSON.stringify(template, null, 2);
}

function groupByPrefix(entries: Array<[string, string]>): Record<string, Array<[string, string]>> {
  const groups: Record<string, Array<[string, string]>> = {};
  for (const entry of entries) {
    const [key] = entry;
    const dot = key.indexOf(".");
    const prefix = dot === -1 ? key : key.slice(0, dot);
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(entry);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// checkMissingTranslation
// ---------------------------------------------------------------------------

/**
 * Combine extraction of hardcoded strings with existing locale data to
 * produce a report that highlights which strings are not yet translated.
 */
export function checkMissingTranslation(root: string, localesDir: string): LocaleReport {
  const extracted = extractHardcodedStrings(root);
  const existing = extractFromI18nFiles(localesDir);

  const extractedKeys = new Set(extracted.map((s) => toKebabCaseKey(s.value)));

  const localeKeys = new Set(existing.untranslatedKeys);
  const allFiles = new Set([...extracted.map((s) => s.file), ...existing.files]);

  const allLangSet = new Set(existing.languages);
  const missingTranslations: LocaleReport["missingTranslations"] = [];

  // For each extracted key, check if it exists in all locale files
  for (const key of extractedKeys) {
    for (const lang of allLangSet) {
      const sourceFile = extracted.find((s) => toKebabCaseKey(s.value) === key)?.file ?? "";
      // A key is missing if it's untranslated in the existing report or
      // simply not present at all
      if (localeKeys.has(key)) {
        missingTranslations.push({ key, language: lang, file: sourceFile });
      } else {
        // Check if this key exists at all in the locale data
        const existsInLocale = existing.missingTranslations.some(
          (m) => m.key === key && m.language === lang,
        );
        if (existsInLocale) {
          missingTranslations.push({ key, language: lang, file: sourceFile });
        }
      }
    }
  }

  return {
    totalStrings: extracted.length,
    files: [...allFiles].sort(),
    languages: [...allLangSet].sort(),
    missingTranslations,
    untranslatedKeys: [...extractedKeys].filter((k) => localeKeys.has(k)),
  };
}

// ---------------------------------------------------------------------------
// scanForHardcodedStrings
// ---------------------------------------------------------------------------

/**
 * Alias combining extraction and detection into a single report.
 */
export function scanForHardcodedStrings(root: string): LocaleReport {
  const extracted = extractHardcodedStrings(root);

  // Detect locale directories relative to root
  const candidates = ["locales", "i18n", "lang", "translations"];
  let localesDir = "";
  for (const dir of candidates) {
    const testDir = join(root, dir);
    try {
      if (statSync(testDir).isDirectory()) {
        localesDir = testDir;
        break;
      }
    } catch {}
  }

  const extractedKeys = extracted.map((s) => toKebabCaseKey(s.value));
  const uniqueKeys = [...new Set(extractedKeys)];
  const allFiles = extracted.map((s) => s.file);
  const uniqueFiles = [...new Set(allFiles)];

  // If we found a locale directory, cross-reference
  if (localesDir) {
    const existing = extractFromI18nFiles(localesDir);
    const localeKeySet = new Set(existing.missingTranslations.map((m) => m.key));

    const missingTranslations: LocaleReport["missingTranslations"] = [];
    const untranslatedKeys: string[] = [];

    for (const key of uniqueKeys) {
      const sourceFile = extracted.find((s) => toKebabCaseKey(s.value) === key)?.file ?? "";
      if (localeKeySet.has(key)) {
        for (const lang of existing.languages) {
          missingTranslations.push({ key, language: lang, file: sourceFile });
        }
        untranslatedKeys.push(key);
      }
    }

    return {
      totalStrings: extracted.length,
      files: uniqueFiles,
      languages: existing.languages,
      missingTranslations,
      untranslatedKeys,
    };
  }

  // No locales directory found — report all extracted keys as untranslated
  // with no language info
  return {
    totalStrings: extracted.length,
    files: uniqueFiles,
    languages: [],
    missingTranslations: [],
    untranslatedKeys: uniqueKeys,
  };
}

// ---------------------------------------------------------------------------
// formatLocaleReport
// ---------------------------------------------------------------------------

/**
 * Produce a human-readable formatted string from a LocaleReport.
 * Missing translations are highlighted with context.
 */
export function formatLocaleReport(report: LocaleReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push("  LOCALIZATION REPORT");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(`  Total strings found:  ${report.totalStrings}`);
  lines.push(`  Files scanned:        ${report.files.length}`);
  lines.push(
    `  Languages detected:   ${report.languages.length > 0 ? report.languages.join(", ") : "none"}`,
  );
  lines.push("");

  if (report.missingTranslations.length > 0) {
    lines.push("─".repeat(60));
    lines.push("  MISSING TRANSLATIONS");
    lines.push("─".repeat(60));
    lines.push("");

    // Group by key for compact display
    const byKey = new Map<string, string[]>();
    for (const mt of report.missingTranslations) {
      const existing = byKey.get(mt.key) ?? [];
      existing.push(mt.language);
      byKey.set(mt.key, existing);
    }

    for (const [key, langs] of byKey) {
      const sourceFile = report.missingTranslations.find((m) => m.key === key)?.file ?? "";
      lines.push(`  [${key}]`);
      lines.push(`    file:   ${sourceFile || "unknown"}`);
      lines.push(`    languages: ${langs.join(", ")}`);
      lines.push("");
    }
  } else {
    lines.push("  No missing translations detected.");
    lines.push("");
  }

  if (report.untranslatedKeys.length > 0) {
    lines.push("─".repeat(60));
    lines.push("  UNTRANSLATED KEYS");
    lines.push("─".repeat(60));
    lines.push("");

    for (const key of report.untranslatedKeys) {
      lines.push(`  - ${key}`);
    }
    lines.push("");
  } else {
    lines.push("  All keys have translations.");
    lines.push("");
  }

  lines.push("=".repeat(60));
  lines.push(`  Report generated at ${new Date().toISOString()}`);
  lines.push("=".repeat(60));

  return lines.join("\n");
}
