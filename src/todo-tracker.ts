#!/usr/bin/env node
/**
 * TODO/FIXME/HACK/NOTE/XXX scanner with aging and author tracking.
 *
 * Scans source files for tagged comments, extracts author and date from
 * git blame/log, computes age in days, and produces structured reports.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TodoType = "TODO" | "FIXME" | "HACK" | "NOTE" | "XXX" | "FOR NOW" | "TEMP" | "WIP" | "TBD";

export interface TodoItem {
  type: TodoType;
  message: string;
  file: string;
  line: number;
  author?: string;
  date?: string;
  age?: number;
}

export interface TodoReport {
  totalItems: number;
  items: TodoItem[];
  byType: Record<string, number>;
  byFile: Record<string, number>;
  byAuthor: Record<string, number>;
  averageAge: number;
  oldestItems: TodoItem[];
}

export interface ScanOptions {
  /** Glob patterns to include (default: src/** / *.{ts,js,tsx,jsx,py,go,rs,java,md,yaml,yml,json}) */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
}

export interface FormatOptions {
  showAge?: boolean;
  groupBy?: "type" | "file" | "author";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODO_REGEX =
  /^(?:\/\/|#|<!--|{\/\*|\/\*| \*)\s*(TODO|FIXME|HACK|NOTE|XXX|FOR NOW|TEMP|WIP|TBD)\b\s*:?\s*(.*?)(?:\*\/|-->)?\s*$/im;

// Default extensions to scan.
const DEFAULT_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".md",
  ".yaml",
  ".yml",
  ".json",
]);

// Directory names always skipped during walk.
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "build",
  ".next",
  "vendor",
  ".gradle",
  "generated",
]);

/** Git blame a single line — returns author email (or undefined). */
function blameAuthor(file: string, line: number): string | undefined {
  try {
    const out = execFileSync("git", ["blame", "-e", "-L", `${line},${line}`, "--", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    // Output format: commit-hash (Author Name <email>  date ) line-content
    const match = out.match(/<([^>]+)>/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Git log – date of the commit that last touched the given line. */
function blameDate(file: string, line: number): string | undefined {
  try {
    const out = execFileSync(
      "git",
      ["log", "--follow", "-1", "--format=%aI", "-L", `${line},${line}`, "--", file],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 8000 },
    );
    const d = out.trim();
    return d || undefined;
  } catch {
    return undefined;
  }
}

/** Parse comment text from a matched line, stripping leading comment markers. */
function extractMessage(text: string): string {
  return text
    .replace(/^\s*(?:\/\/|#|<!--?|\/\*+|\*+)\s*/, "")
    .replace(/\s*(?:\*\/|-->)?\s*$/, "")
    .trim();
}

/** Convert a glob pattern (with **, *) into a RegExp. */
function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/** Check if a file path matches a simple glob pattern. */
function globMatch(file: string, pattern: string): boolean {
  return globToRegExp(pattern).test(file);
}

// ---------------------------------------------------------------------------
// Core scanning
// ---------------------------------------------------------------------------

/**
 * Recursively walk the directory tree collecting files whose extension matches.
 */
function walkFiles(root: string): string[] {
  const result: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") && entry !== ".env.example") continue; // skip dotfiles (except example)
      const full = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(full);
      } else if (st.isFile() && DEFAULT_EXTENSIONS.has(extname(full))) {
        result.push(full);
      }
    }
  }

  walk(resolve(root));
  return result;
}

/**
 * Recursively scan `root` for TODO/FIXME/HACK/NOTE/XXX comments.
 *
 * Uses git blame and git log to enrich each item with author and date.
 */
export function scanForTodos(root: string, options?: ScanOptions): TodoReport {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);

  const include = options?.include;
  const exclude = options?.exclude ? new Set(options.exclude) : undefined;

  // If include patterns are provided, filter the walked files.
  const files = include ? filterByInclude(allFiles, include, resolvedRoot) : allFiles;

  const items: TodoItem[] = [];

  for (const file of files) {
    const relFile = relative(resolvedRoot, file);
    // Apply exclude checks on relative path.
    if (exclude && [...exclude].some((pat) => globMatch(relFile, pat))) continue;

    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue; // skip unreadable
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Quick bail-out: must contain a common comment marker.
      if (!/\/\/|#|<!--?|\/\*/.test(line)) continue;

      const match = TODO_REGEX.exec(line);
      if (!match) continue;

      const type = match[1].toUpperCase() as TodoType;
      const rawMessage = match[2] || "";
      const message = extractMessage(rawMessage || type);

      const lineNum = i + 1;
      const author = blameAuthor(file, lineNum);
      const date = blameDate(file, lineNum);
      let age: number | undefined;
      if (date) {
        age = daysSince(date);
      }

      items.push({
        type,
        message,
        file: relFile,
        line: lineNum,
        author,
        date,
        age,
      });
    }
  }

  return buildReport(items);
}

function filterByInclude(files: string[], includes: string[], root: string): string[] {
  const includePatterns = includes.map((p) => globToRegExp(p));
  return files.filter((f) => {
    const rel = relative(root, f);
    return includePatterns.some((re) => re.test(rel));
  });
}

/** Assemble a TodoReport from an array of TodoItems. */
function buildReport(items: TodoItem[]): TodoReport {
  const byType: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  const byAuthor: Record<string, number> = {};

  let totalAge = 0;
  let ageCount = 0;

  for (const item of items) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    byFile[item.file] = (byFile[item.file] ?? 0) + 1;
    const author = item.author ?? "unknown";
    byAuthor[author] = (byAuthor[author] ?? 0) + 1;

    if (item.age !== undefined) {
      totalAge += item.age;
      ageCount++;
    }
  }

  const averageAge = ageCount > 0 ? Math.round(totalAge / ageCount) : 0;

  // Oldest items (top 10)
  const withAge = items
    .filter((i) => i.age !== undefined)
    .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  const oldestItems = withAge.slice(0, 10);

  return {
    totalItems: items.length,
    items,
    byType,
    byFile,
    byAuthor,
    averageAge,
    oldestItems,
  };
}

// ---------------------------------------------------------------------------
// Age calculation
// ---------------------------------------------------------------------------

/** Calculate number of days between ISO date string and now. */
function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 0;
  const now = Date.now();
  const diffMs = now - then;
  return Math.floor(diffMs / 86_400_000);
}

/**
 * Compute age (days since git commit date) for a single TodoItem.
 * Falls back to `item.date` if present; if not, runs git log.
 */
export function calculateAge(item: TodoItem): number {
  if (item.age !== undefined) return item.age;
  if (item.date) return daysSince(item.date);
  // Attempt git log
  const date = blameDate(item.file, item.line);
  return date ? daysSince(date) : 0;
}

// ---------------------------------------------------------------------------
// History (persistent tracking via .claude/todo-history.jsonl)
// ---------------------------------------------------------------------------

const HISTORY_FILE = ".claude/todo-history.jsonl";

/**
 * Read previous TODO reports from `.claude/todo-history.jsonl`.
 * Each line is a JSON-serialised TodoReport.
 */
export function getTodoHistory(root: string): TodoReport[] {
  const historyPath = join(resolve(root), HISTORY_FILE);
  if (!existsSync(historyPath)) return [];

  try {
    const content = readFileSync(historyPath, "utf-8");
    const reports: TodoReport[] = [];
    for (const line of content.trim().split("\n")) {
      if (!line) continue;
      try {
        reports.push(JSON.parse(line) as TodoReport);
      } catch {
        // skip corrupt lines
      }
    }
    return reports;
  } catch {
    return [];
  }
}

/**
 * Append a report to `.claude/todo-history.jsonl`.
 */
export function appendTodoHistory(root: string, report: TodoReport): void {
  const rootResolved = resolve(root);
  const dir = join(rootResolved, ".claude");
  const historyPath = join(dir, "todo-history.jsonl");

  if (!existsSync(dir)) {
    // Silently skip if .claude doesn't exist — caller may not want to force-create it.
    return;
  }

  try {
    writeFileSync(historyPath, JSON.stringify(report) + "\n", { flag: "a", encoding: "utf-8" });
  } catch {
    // fail silently — non-critical
  }
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Format a TodoReport as a readable Markdown string.
 */
export function formatTodoReport(report: TodoReport, options?: FormatOptions): string {
  const { showAge = true, groupBy } = options ?? {};
  const lines: string[] = [];

  lines.push("# TODO/FIXME/HACK/NOTE/XXX Report");
  lines.push("");
  lines.push(`**Total items:** ${report.totalItems}`);
  lines.push(`**Average age:** ${report.averageAge} days`);
  lines.push("");

  // Breakdown by type
  lines.push("## By Type");
  lines.push("| Type | Count |");
  lines.push("|------|-------|");
  for (const [type, count] of Object.entries(report.byType).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push("");

  // Breakdown by file (top 15)
  lines.push("## By File (top 15)");
  lines.push("| File | Count |");
  lines.push("|------|-------|");
  const topFiles = Object.entries(report.byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [file, count] of topFiles) {
    lines.push(`| ${file} | ${count} |`);
  }
  lines.push("");

  // Breakdown by author (top 10)
  lines.push("## By Author (top 10)");
  lines.push("| Author | Count |");
  lines.push("|--------|-------|");
  const topAuthors = Object.entries(report.byAuthor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [author, count] of topAuthors) {
    lines.push(`| ${author} | ${count} |`);
  }
  lines.push("");

  // Oldest items
  if (showAge && report.oldestItems.length > 0) {
    lines.push("## Oldest Items");
    lines.push("| Type | File | Line | Age (days) | Message |");
    lines.push("|------|------|------|------------|---------|");
    for (const item of report.oldestItems) {
      const age = item.age ?? calculateAge(item);
      lines.push(
        `| ${item.type} | ${item.file} | ${item.line} | ${age} | ${escapeMarkdown(item.message)} |`,
      );
    }
    lines.push("");
  }

  // Detailed listing, optionally grouped
  if (report.items.length > 0) {
    lines.push("## All Items");

    if (groupBy === "type") {
      for (const t of ["TODO", "FIXME", "HACK", "NOTE", "XXX", "FOR NOW", "TEMP", "WIP", "TBD"] as TodoType[]) {
        const group = report.items.filter((i) => i.type === t);
        if (group.length === 0) continue;
        lines.push(`\n### ${t} (${group.length})`);
        lines.push("");
        lines.push(formatItemTable(group, showAge));
      }
    } else if (groupBy === "file") {
      const fileGroups = new Map<string, TodoItem[]>();
      for (const item of report.items) {
        const arr = fileGroups.get(item.file) ?? [];
        arr.push(item);
        fileGroups.set(item.file, arr);
      }
      for (const [file, group] of [...fileGroups.entries()].sort()) {
        lines.push(`\n### ${file} (${group.length})`);
        lines.push("");
        lines.push(formatItemTable(group, showAge));
      }
    } else if (groupBy === "author") {
      const authorGroups = new Map<string, TodoItem[]>();
      for (const item of report.items) {
        const author = item.author ?? "unknown";
        const arr = authorGroups.get(author) ?? [];
        arr.push(item);
        authorGroups.set(author, arr);
      }
      for (const [author, group] of [...authorGroups.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        lines.push(`\n### ${author} (${group.length})`);
        lines.push("");
        lines.push(formatItemTable(group, showAge));
      }
    } else {
      lines.push("");
      lines.push(formatItemTable(report.items, showAge));
    }
  }

  return lines.join("\n");
}

function formatItemTable(items: TodoItem[], showAge: boolean): string {
  const header = showAge
    ? "| Type | File | Line | Age (d) | Author | Message |"
    : "| Type | File | Line | Author | Message |";
  const sep = showAge
    ? "|------|------|------|---------|--------|---------|"
    : "|------|------|------|--------|---------|";
  const rows = items.map((item) => {
    const age = item.age ?? calculateAge(item);
    const author = item.author ?? "-";
    const msg = escapeMarkdown(item.message);
    if (showAge) {
      return `| ${item.type} | ${item.file} | ${item.line} | ${age} | ${author} | ${msg} |`;
    }
    return `| ${item.type} | ${item.file} | ${item.line} | ${author} | ${msg} |`;
  });
  return [header, sep, ...rows].join("\n");
}

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ---------------------------------------------------------------------------
// Differential scan
// ---------------------------------------------------------------------------

/**
 * Compare TODOs on the current HEAD against a git ref (default: HEAD~1).
 * Returns only newly-introduced TODO items.
 *
 * Works by running the scan on the diff between `ref` and HEAD.
 */
export function scanSince(ref?: string): TodoReport {
  const base = ref ?? "HEAD~1";
  let diffFiles: string[];
  try {
    const out = execFileSync("git", ["diff", "--name-only", base, "--diff-filter=ACMRTUXB"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    diffFiles = out.trim().split("\n").filter(Boolean);
  } catch {
    // Fall back to scanning everything from current dir
    return scanForTodos(process.cwd());
  }

  if (diffFiles.length === 0) {
    return {
      totalItems: 0,
      items: [],
      byType: {},
      byFile: {},
      byAuthor: {},
      averageAge: 0,
      oldestItems: [],
    };
  }

  const root = resolve(process.cwd());
  const items: TodoItem[] = [];

  for (const file of diffFiles) {
    // Only process files that exist on disk
    const absFile = join(root, file);
    if (!existsSync(absFile)) continue;

    let content: string;
    try {
      content = readFileSync(absFile, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/\/\/|#|<!--?|\/\*/.test(line)) continue;

      const match = TODO_REGEX.exec(line);
      if (!match) continue;

      const type = match[1].toUpperCase() as TodoType;
      const rawMessage = match[2] || "";
      const message = extractMessage(rawMessage || type);
      const lineNum = i + 1;
      const author = blameAuthor(absFile, lineNum);
      const date = blameDate(absFile, lineNum);
      let age: number | undefined;
      if (date) age = daysSince(date);

      items.push({ type, message, file, line: lineNum, author, date, age });
    }
  }

  return buildReport(items);
}
