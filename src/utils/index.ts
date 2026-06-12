import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

// ─── Text ───────────────────────────────────────────────────────────────────

/**
 * Escape special regex characters in a string.
 * Use before passing user input to `new RegExp()`.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/** Alias for escapeRegex — same function body. */
export const escapeRegExp = escapeRegex;

/**
 * Escape pipe (|), newline, and carriage return characters for Markdown tables.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "");
}

// ─── Glob ───────────────────────────────────────────────────────────────────

/**
 * Convert a glob pattern (with **, *) into a RegExp.
 */
export function globToRegExp(pattern: string): RegExp {
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
      source += escapeRegex(char);
    }
  }

  return new RegExp(`${source}$`);
}

/**
 * Check if a file path matches a simple glob pattern.
 */
export function globMatch(file: string, pattern: string): boolean {
  return globToRegExp(pattern).test(file);
}

// ─── JSON ───────────────────────────────────────────────────────────────────

/**
 * Safely read and parse a JSON file. Returns null on failure.
 */
export function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Filesystem ─────────────────────────────────────────────────────────────

/**
 * Ensure a directory (or its parent) exists, creating it recursively if needed.
 *
 * @param dirPath — Absolute directory path to ensure exists.
 */
export function ensureDirSync(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Ensure a directory exists and return the path.
 * Useful for returning the dir in expressions.
 *
 * @param dirPath — Absolute directory path to ensure exists.
 * @returns The input dirPath.
 */
export function ensureDir(dirPath: string): string {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Ensure the parent directory of a file path exists.
 *
 * @param filePath — Path to a file whose parent directory should exist.
 */
export function ensureParentDirSync(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ─── Git Blame Helpers ───────────────────────────────────────────────────────

/**
 * Get the author from git blame for a specific line.
 * @param file — Absolute file path
 * @param line — Line number
 * @returns Author email or undefined on failure
 */
export function blameAuthor(file: string, line: number): string | undefined {
  try {
    const out = execFileSync("git", ["blame", "-e", "-L", `${line},${line}`, "--", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    const match = out.match(/<([^>]+)>/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get the last commit date for a specific line via git log.
 * @param file — Absolute file path
 * @param line — Line number
 * @returns ISO date string or undefined on failure
 */
export function blameDate(file: string, line: number): string | undefined {
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

/**
 * Calculate the number of days between an ISO date and now.
 * @param isoDate — ISO date string
 * @returns Number of days
 */
export function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 0;
  const now = Date.now();
  const diffMs = now - then;
  return Math.floor(diffMs / 86_400_000);
}

// ─── Duplicated utilities consolidated from across codebase ─────────────────────

/**
 * Recursively walk a directory collecting files with recognized extensions.
 * Default extensions: .ts, .tsx, .js, .jsx, .mjs, .cjs, .json, .md, .css, .html
 */
export function walkFiles(root: string): string[] {
  const result: string[] = [];
  const EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".html",
  ]);
  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        if (entry.startsWith(".")) continue;
        const s = statSync(full);
        if (s.isDirectory()) walk(full);
        else if (s.isFile() && EXTENSIONS.has(extname(full))) result.push(full);
      } catch {
        continue;
      }
    }
  }
  walk(root);
  return result;
}

/**
 * Ensure a storage directory exists and return its absolute path.
 */
export function ensureStorageDir(storageDir: string, root?: string): string {
  const base = root ? resolve(root) : process.cwd();
  return ensureDir(join(base, storageDir));
}

/**
 * Generate a unique ID with the given prefix.
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Format a Stats object or stats-like record as a Markdown report block.
 */
export function formatReport(stats: {
  total: number;
  byOutcome?: Record<string, number>;
  [key: string]: unknown;
}): string {
  const lines: string[] = ["## Report", ""];
  lines.push(`**Total:** ${stats.total}`);
  if (stats.byOutcome) {
    lines.push("", "### Breakdown", "| Outcome | Count |", "|---------|-------|");
    for (const [k, v] of Object.entries(stats.byOutcome)) {
      const pct = stats.total > 0 ? (((v as number) / stats.total) * 100).toFixed(1) : "0.0";
      lines.push(`| ${k} | ${v} (${pct}%) |`);
    }
  }
  return lines.join("\n");
}

/**
 * Format bytes as a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** i;
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
