import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

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
