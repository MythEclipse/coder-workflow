#!/usr/bin/env node
/**
 * Tech Debt Tracker
 *
 * Scans projects for TODO/FIXME/HACK, automatically classifies them,
 * and generates a structured tech debt report.
 *
 * Features:
 * 1. Scans TODO/FIXME/HACK comments with type and severity classification
 * 2. Automatic classification based on comment text
 * 3. Per-module, per-type tracking, and debt score
 * 4. Tech debt budget checking
 * 5. Mark resolved for fixed items
 * 6. Report and dashboard formatting for human-readable output
 * 7. Persistent storage in .claude/tech-debt-tracker/
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { blameAuthor, blameDate, daysSince, escapeMarkdown } from "./utils/index.js";

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * Detected type of technical debt.
 * - bug:       Issues that could cause errors or incorrect behavior
 * - enhancement: Requests for feature additions or improvements
 * - refactor:   Code that needs refactoring for maintainability
 * - documentation: Missing or inaccurate documentation
 * - security:   Potential security vulnerabilities
 * - performance: Performance issues or optimizations
 */
export type DebtType =
  | "bug"
  | "enhancement"
  | "refactor"
  | "documentation"
  | "security"
  | "performance";

/**
 * Severity level of technical debt.
 * - critical: High impact, needs immediate fixing
 * - major:    Significant impact, needs scheduling
 * - minor:    Low impact, can be deferred
 */
export type DebtSeverity = "critical" | "major" | "minor";

/**
 * Lifecycle status of a tech debt item.
 */
export type DebtStatus = "open" | "resolved";

/**
 * Representation of a single detected tech debt item.
 */
export interface DebtEntry {
  /** Unique ID for this item */
  id: string;
  /** ISO timestamp when the item was first detected */
  timestamp: string;
  /** File path relative to project root */
  file: string;
  /** Line number in the file */
  line: number;
  /** Debt type classification */
  type: DebtType;
  /** Severity level */
  severity: DebtSeverity;
  /** Description or message from the comment */
  description: string;
  /** Author (from git blame) */
  author?: string;
  /** Age of the item in days since the last commit touching this line */
  age: number;
  /** Status — whether still open or resolved */
  status: DebtStatus;
  /** ISO timestamp when resolved (undefined if still open) */
  resolvedAt?: string;
}

/**
 * Aggregate tech debt statistics.
 */
export interface DebtStats {
  /** Total number of debt items */
  total: number;
  /** Count of items per severity */
  bySeverity: Record<DebtSeverity, number>;
  /** Count of items per type */
  byType: Record<DebtType, number>;
  /** Count of items per module (level-1 directory) */
  byModule: Record<string, number>;
  /** Cumulative debt score (critical=10, major=5, minor=1) */
  score: number;
  /** Average age of items in days */
  averageAge: number;
  /** Number of items that have been resolved */
  resolved: number;
  /** Number of items still open */
  open: number;
}

/**
 * Complete tech debt report.
 */
export interface DebtReport {
  /** Total scanned items */
  totalScanned: number;
  /** List of debt items */
  items: DebtEntry[];
  /** Aggregate statistics */
  stats: DebtStats;
  /** Timestamp when the report was generated */
  generatedAt: string;
  /** Root directory that was scanned */
  root: string;
}

/**
 * Result of automatic classification for a comment text.
 */
export interface ClassificationResult {
  type: DebtType;
  severity: DebtSeverity;
}

/**
 * Result of tech debt budget checking.
 */
export interface BudgetCheckResult {
  /** Whether the budget is exceeded */
  exceeded: boolean;
  /** Current debt score */
  currentScore: number;
  /** Budget threshold */
  threshold: number;
  /** Remaining budget (negative if exceeded) */
  remaining: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

/** Storage directory for tech debt data */
const DEBT_DIR = ".claude/tech-debt-tracker";
/** File for storing debt items */
const ITEMS_FILE = "items.json";
/** History file for status changes */
const HISTORY_FILE = "history.jsonl";

/** Bobot skor per severity */
const SEVERITY_WEIGHTS: Record<DebtSeverity, number> = {
  critical: 10,
  major: 5,
  minor: 1,
};

/** Regex pattern for detecting TODO/FIXME/HACK comments */
const DEBT_COMMENT_REGEX =
  /^(?:\/\/|#|<!--?|\/\*+| \*)\s*(TODO|FIXME|HACK|XXX|OPTIMIZE|REVIEW|SECURITY|PERF|WORKAROUND|KLUDGE|TEMP|WIP|TBD)\b\s*:?\s*(.*?)(?:\*\/|-->)?\s*$/im;

/** File extensions to scan */
const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".dart",
  ".scala",
  ".md",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
]);

/** Directories always skipped during scanning */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "build",
  ".next",
  ".turbo",
  "vendor",
  ".gradle",
  "generated",
  "coverage",
  ".nyc_output",
  ".claude",
  "target",
  "out",
  "bin",
  "obj",
]);

// ─── Storage ─────────────────────────────────────────────────────────────

/**
 * Ensures the storage directory exists, creates it if it doesn't.
 * @returns Absolute path to the storage directory
 */
function ensureStorageDir(): string {
  const dir = join(process.cwd(), DEBT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Loads debt items from storage.
 * @returns List of stored DebtEntry
 */
function loadItems(): DebtEntry[] {
  const dir = ensureStorageDir();
  const filePath = join(dir, ITEMS_FILE);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DebtEntry[];
  } catch {
    return [];
  }
}

/**
 * Saves debt items to storage.
 * @param items List of DebtEntry to be saved
 */
function saveItems(items: DebtEntry[]): void {
  const dir = ensureStorageDir();
  writeFileSync(join(dir, ITEMS_FILE), JSON.stringify(items, null, 2), "utf-8");
}

/**
 * Records an event to the history file (JSONL).
 * @param event Event object to be recorded
 */
function appendHistory(event: Record<string, unknown>): void {
  try {
    const dir = ensureStorageDir();
    appendFileSync(
      join(dir, HISTORY_FILE),
      JSON.stringify({ ...event, _timestamp: new Date().toISOString() }) + "\n",
      "utf-8",
    );
  } catch {
    // Non-critical, fail silently
  }
}

// ─── Classification ───────────────────────────────────────────────────

/**
 * Keyword patterns for detecting tech debt types.
 * Each type has an array of regex patterns to match against.
 */
const TYPE_PATTERNS: Record<DebtType, RegExp[]> = {
  bug: [
    /\b(bug|buggy|broken|crash|error|fails?|wrong|incorrect|fixme)\b/i,
    /\b(not work|doesn't work|unexpected|glitch|malfunction)\b/i,
    /\b(hotfix|workaround|patch|issue|problem|fault)\b/i,
    /\b(null|undefined|exception|throw|fail)\b/i,
  ],
  security: [
    /\b(security|secure|vuln|cve|xss|csrf|sqli|injection|sanitize)\b/i,
    /\b(escape|validate input|auth|authorization|permission|sensitive)\b/i,
    /\b(encrypt|decrypt|hash|password|token|secret|key)\b/i,
    /\b(SECURITY|SEC|CWE|OWASP)\b/i,
  ],
  performance: [
    /\b(perform|slow|fast|speed|optimize|bottleneck|latency|n\+1)\b/i,
    /\b(cache|memoize|lazy|debounce|throttle|timeout|async)\b/i,
    /\b(memory|leak|cpu|disk|io|network|expensive|heavy)\b/i,
    /\b(PERF|OPTIMIZE|OPT|EFFICIENCY)\b/i,
  ],
  refactor: [
    /\b(refactor|cleanup|duplicate|redundant|mess|legacy)\b/i,
    /\b(tech.debt|works but|ugly|hack|kludge|workaround|temp)\b/i,
    /\b(HACK|TEMP|WIP|TBD|TODO|XXX|simplify|extract|split)\b/i,
    /\b(magic.number|hardcoded|coupling|cohesion|spaghetti)\b/i,
  ],
  documentation: [
    /\b(doc|comment|document|readme|README|api.doc|jsdoc)\b/i,
    /\b(explain|clarify|describe|note|example|usage)\b/i,
    /\b(why|how|what|missing doc|undocumented|incomplete)\b/i,
  ],
  enhancement: [
    /\b(feature|enhance|improve|better|support|add|future)\b/i,
    /\b(should|could|would|need to|want|nice.to.have|todo)\b/i,
    /\b(implement|wire.up|integrate|connect|expose|allow)\b/i,
  ],
};

/**
 * Keyword patterns for detecting severity levels.
 */
const SEVERITY_PATTERNS: Record<DebtSeverity, RegExp[]> = {
  critical: [
    /\b(critical|urgent|blocker|crash|security|data.loss|data loss)\b/i,
    /\b(immediate|asap|ASAP|P0|P-0|showstopper|production)\b/i,
    /\b(FIXME|fix.me|broken|vuln|exploit|downtime)\b/i,
  ],
  major: [
    /\b(major|important|should fix|significant|high)\b/i,
    /\b(P1|P-1|bug|error|refactor|cleanup|slow)\b/i,
    /\b(need to|must|required|necessary|essential)\b/i,
  ],
  minor: [
    /\b(minor|trivial|cosmetic|nit|style|cosmetic)\b/i,
    /\b(nice.to.have|optional|maybe|could|suggestion)\b/i,
    /\b(P2|P-2|P3|polish|typo|format|rename|TODO)\b/i,
  ],
};

/**
 * Classifies a comment text automatically based on keyword patterns.
 *
 * This function matches the comment text against predefined patterns
 * to determine the type and severity level of technical debt.
 *
 * @param text Comment text to be classified
 * @returns Classification result containing type and severity
 *
 * @example
 * ```ts
 * const result = classifyDebt("FIXME: this crashes on null input");
 * // { type: "bug", severity: "critical" }
 * ```
 */
export function classifyDebt(text: string): ClassificationResult {
  const result: ClassificationResult = {
    type: "refactor",
    severity: "minor",
  };

  // Calculate score for each type
  let maxTypeScore = 0;
  for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        score += 2;
      }
    }
    // Bonus for keywords appearing at the start (like TODO, FIXME, etc.)
    const prefixMatch = text.match(/^(TODO|FIXME|HACK|XXX|SECURITY|PERF|OPTIMIZE|REVIEW)\b/i);
    if (prefixMatch) {
      const prefixMap: Record<string, DebtType> = {
        FIXME: "bug",
        SECURITY: "security",
        PERF: "performance",
        OPTIMIZE: "performance",
        REVIEW: "refactor",
        HACK: "refactor",
        XXX: "refactor",
      };
      if (prefixMap[prefixMatch[1].toUpperCase()] === type) {
        score += 3;
      }
    }
    if (score > maxTypeScore) {
      maxTypeScore = score;
      result.type = type as DebtType;
    }
  }

  // Calculate score for each severity
  let maxSeverityScore = 0;
  for (const [severity, patterns] of Object.entries(SEVERITY_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        score += 1;
      }
    }
    if (score > maxSeverityScore) {
      maxSeverityScore = score;
      result.severity = severity as DebtSeverity;
    }
  }

  // If no patterns matched, use defaults based on prefix
  if (maxTypeScore === 0) {
    const upper = text.toUpperCase();
    if (upper.startsWith("FIXME")) {
      result.type = "bug";
      result.severity = "major";
    } else if (upper.startsWith("SECURITY") || upper.startsWith("SEC")) {
      result.type = "security";
      result.severity = "critical";
    } else if (upper.startsWith("PERF") || upper.startsWith("OPTIMIZE")) {
      result.type = "performance";
      result.severity = "major";
    } else if (
      upper.startsWith("HACK") ||
      upper.startsWith("KLUDGE") ||
      upper.startsWith("WORKAROUND")
    ) {
      result.type = "refactor";
      result.severity = "major";
    } else if (upper.startsWith("TODO")) {
      result.type = "enhancement";
      result.severity = "minor";
    }
  }

  return result;
}

// ─── File Scanning ────────────────────────────────────────────────────

/**
 * Walks the directory tree recursively and
 * collects files with recognized extensions.
 *
 * @param root Root directory path
 * @returns List of absolute file paths found
 */
function walkFiles(root: string): string[] {
  const result: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") && entry !== ".env.example" && entry !== ".eslintrc.js") continue;
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
      } else if (st.isFile() && SCAN_EXTENSIONS.has(extname(full))) {
        result.push(full);
      }
    }
  }

  walk(resolve(root));
  return result;
}

/**
 * Extracts description text from a comment, stripping comment markers.
 *
 * @param text Raw text from the comment
 * @returns Cleaned text
 */
function extractDescription(text: string): string {
  return text
    .replace(/^\s*(?:\/\/|#|<!--?|\/\*+|\*+)\s*/, "")
    .replace(/\s*(?:\*\/|-->)?\s*$/, "")
    .trim();
}

/**
 * Gets the module name from a file path.
 * A module is defined as the level-1 directory relative to root.
 *
 * @param filePath Relative file path
 * @returns Module name
 */
function getModuleName(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "(root)";
  return parts[0];
}

// ─── Core Scanning ────────────────────────────────────────────────────

/**
 * Scans the entire project for technical debt.
 *
 * This function reads all source code files, looks for
 * TODO/FIXME/HACK/etc. comments, classifies them, and returns
 * a list of DebtEntry enriched with author, date, and age.
 *
 * @param root Project root path to scan
 * @returns Array of discovered DebtEntry
 *
 * @example
 * ```ts
 * const debts = scanForDebt("/path/to/project");
 * console.log(`Found ${debts.length} tech debt items`);
 * ```
 */
export function scanForDebt(root: string): DebtEntry[] {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);

  // Load existing items for reference (de-duplication)
  const existingItems = loadItems();
  const existingKeySet = new Set(existingItems.map((i) => `${i.file}:${i.line}`));

  const newItems: DebtEntry[] = [];
  const now = new Date().toISOString();

  for (const file of allFiles) {
    const relFile = relative(resolvedRoot, file).replace(/\\/g, "/");

    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];

      // Quick bail-out: must contain comment marker
      if (!/\/\/|#|<!--?|\/\*/.test(lineText)) continue;

      const match = DEBT_COMMENT_REGEX.exec(lineText);
      if (!match) continue;

      const rawTag = match[1].toUpperCase();
      const rawMessage = match[2] || "";
      const description = extractDescription(rawMessage || rawTag);
      const lineNum = i + 1;

      // Skip duplicates
      const uniqueKey = `${relFile}:${lineNum}`;
      if (existingKeySet.has(uniqueKey)) continue;

      // Automatic classification
      const classification = classifyDebt(description);

      // Enrich with git blame
      const author = blameAuthor(file, lineNum);
      const date = blameDate(file, lineNum);
      const age = date ? daysSince(date) : 0;

      const entry: DebtEntry = {
        id: `debt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: now,
        file: relFile,
        line: lineNum,
        type: classification.type,
        severity: classification.severity,
        description,
        author,
        age,
        status: "open",
      };

      newItems.push(entry);
    }
  }

  // Merge new items with existing ones, update existing ones
  const mergedItems = mergeItems(existingItems, newItems);
  saveItems(mergedItems);
  appendHistory({ event: "scan", found: newItems.length, total: mergedItems.length });

  return mergedItems;
}

/**
 * Merges new items with existing items.
 * Existing items are preserved (including resolved status).
 * New items are added. Items that no longer appear in files
 * are kept (for history reference), but can be filtered.
 *
 * @param existing Previously stored items
 * @param newItems New items from the scan
 * @returns Merged array
 */
function mergeItems(existing: DebtEntry[], newItems: DebtEntry[]): DebtEntry[] {
  const existingMap = new Map<string, DebtEntry>();
  for (const item of existing) {
    const key = `${item.file}:${item.line}`;
    existingMap.set(key, item);
  }

  // Add new items that don't exist yet
  for (const item of newItems) {
    const key = `${item.file}:${item.line}`;
    if (!existingMap.has(key)) {
      existingMap.set(key, item);
    }
  }

  return [...existingMap.values()];
}

// ─── Query & Report ───────────────────────────────────────────────────

/**
 * Gets all open debt items.
 *
 * @returns Array of DebtEntry with open status
 */
export function getOpenDebts(): DebtEntry[] {
  return loadItems().filter((i) => i.status === "open");
}

/**
 * Gets debt items grouped by module.
 *
 * A module is defined as a level-1 directory.
 * Example: `src/`, `docs/`, `tests/`
 *
 * @returns Record with module name as key, DebtEntry array as value
 *
 * @example
 * ```ts
 * const byModule = getDebtByModule();
 * for (const [module, items] of Object.entries(byModule)) {
 *   console.log(`${module}: ${items.length} items`);
 * }
 * ```
 */
export function getDebtByModule(): Record<string, DebtEntry[]> {
  const items = loadItems();
  const result: Record<string, DebtEntry[]> = {};

  for (const item of items) {
    const module = getModuleName(item.file);
    if (!result[module]) {
      result[module] = [];
    }
    result[module].push(item);
  }

  return result;
}

/**
 * Gets debt items grouped by type.
 *
 * @returns Record with debt type as key, DebtEntry array as value
 *
 * @example
 * ```ts
 * const byType = getDebtByType();
 * console.log(`Bug: ${byType.bug?.length ?? 0}`);
 * ```
 */
export function getDebtByType(): Record<DebtType, DebtEntry[]> {
  const items = loadItems();
  const result: Record<string, DebtEntry[]> = {};

  for (const item of items) {
    if (!result[item.type]) {
      result[item.type] = [];
    }
    result[item.type].push(item);
  }

  return result;
}

/**
 * Calculates tech debt metrics and score.
 *
 * Score is calculated with weights: critical = 10, major = 5, minor = 1.
 * The total score provides an overview of the overall tech debt level.
 *
 * @returns DebtStats with all aggregate metrics
 *
 * @example
 * ```ts
 * const stats = getDebtScore();
 * console.log(`Debt score: ${stats.score}`);
 * console.log(`Total items: ${stats.total}`);
 * ```
 */
export function getDebtScore(): DebtStats {
  const items = loadItems();
  const activeItems = items.filter((i) => i.status === "open");

  const bySeverity: Record<DebtSeverity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
  };

  const byType: Record<DebtType, number> = {
    bug: 0,
    enhancement: 0,
    refactor: 0,
    documentation: 0,
    security: 0,
    performance: 0,
  };

  const byModule: Record<string, number> = {};
  let totalAge = 0;

  for (const item of activeItems) {
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
    byType[item.type] = (byType[item.type] ?? 0) + 1;

    const module = getModuleName(item.file);
    byModule[module] = (byModule[module] ?? 0) + 1;

    totalAge += item.age;
  }

  // Calculate cumulative score
  const score = Object.entries(bySeverity).reduce((acc, [sev, count]) => {
    return acc + count * (SEVERITY_WEIGHTS[sev as DebtSeverity] ?? 1);
  }, 0);

  const averageAge = activeItems.length > 0 ? Math.round(totalAge / activeItems.length) : 0;

  const resolved = items.filter((i) => i.status === "resolved").length;
  const open = activeItems.length;

  return {
    total: items.length,
    bySeverity,
    byType,
    byModule,
    score,
    averageAge,
    resolved,
    open,
  };
}

/**
 * Checks whether the tech debt score exceeds the specified budget threshold.
 *
 * The default budget threshold is 100. If the score exceeds the threshold,
 * it is considered that tech debt reduction actions are needed.
 *
 * @param threshold Score threshold (default: 100)
 * @returns BudgetCheckResult with exceeded status and details
 *
 * @example
 * ```ts
 * if (isDebtBudgetExceeded(50)) {
 *   console.log("Tech debt budget exceeded!");
 * }
 * ```
 */
export function isDebtBudgetExceeded(threshold: number = 100): BudgetCheckResult {
  const stats = getDebtScore();
  const currentScore = stats.score;

  return {
    exceeded: currentScore > threshold,
    currentScore,
    threshold,
    remaining: threshold - currentScore,
  };
}

/**
 * Marks a debt item as resolved (fixed).
 *
 * Records the resolved timestamp and saves changes to storage.
 *
 * @param id ID of the DebtEntry to resolve
 * @returns Boolean true if successful, false if ID not found
 *
 * @example
 * ```ts
 * const success = markResolved("debt-1234567890-abc123");
 * if (success) console.log("Item successfully resolved");
 * ```
 */
export function markResolved(id: string): boolean {
  const items = loadItems();
  let found = false;

  for (const item of items) {
    if (item.id === id) {
      item.status = "resolved";
      item.resolvedAt = new Date().toISOString();
      found = true;
      break;
    }
  }

  if (found) {
    saveItems(items);
    appendHistory({ event: "resolved", id });
  }

  return found;
}

/**
 * Reverses the resolved status, returning the item to open status.
 *
 * @param id ID of the DebtEntry to reopen
 * @returns Boolean true if successful
 */
export function markOpen(id: string): boolean {
  const items = loadItems();
  let found = false;

  for (const item of items) {
    if (item.id === id) {
      item.status = "open";
      item.resolvedAt = undefined;
      found = true;
      break;
    }
  }

  if (found) {
    saveItems(items);
    appendHistory({ event: "reopened", id });
  }

  return found;
}

/**
 * Gets a complete tech debt report after running a scan.
 *
 * Combines scan results with statistics and report metadata.
 *
 * @param root Project root path to scan
 * @returns DebtReport with all information
 *
 * @example
 * ```ts
 * const report = getDebtReport("/path/to/project");
 * console.log(report.stats.score);
 * ```
 */
export function getDebtReport(root: string): DebtReport {
  const items = scanForDebt(root);
  const stats = getDebtScore();

  return {
    totalScanned: items.length,
    items,
    stats,
    generatedAt: new Date().toISOString(),
    root: resolve(root),
  };
}

// ─── Format ───────────────────────────────────────────────────────────

/**
 * Formats a list of tech debt items into a clean Markdown table.
 *
 * @param items List of DebtEntry to format
 * @param stats Debt statistics (optional, for summary)
 * @returns Markdown string
 *
 * @example
 * ```ts
 * const report = formatDebtReport(debts, stats);
 * console.log(report);
 * ```
 */
export function formatDebtReport(items: DebtEntry[], stats?: DebtStats): string {
  const lines: string[] = [];

  lines.push("# Tech Debt Report");
  lines.push("");

  if (stats) {
    lines.push(`**Total items:** ${stats.total} (${stats.open} open, ${stats.resolved} resolved)`);
    lines.push(`**Debt score:** ${stats.score}`);
    lines.push(`**Average age:** ${stats.averageAge} days`);
    lines.push(`**Critical items:** ${stats.bySeverity.critical}`);
    lines.push(`**Major items:** ${stats.bySeverity.major}`);
    lines.push("");
  }

  lines.push("## Item Details");
  lines.push("");
  lines.push("| ID | File | Line | Type | Severity | Age (d) | Author | Description |");
  lines.push("|-----|------|------|------|----------|-----------|--------|-----------|");

  for (const item of items) {
    const idShort = item.id.slice(0, 16);
    const author = item.author ?? "-";
    const desc = escapeMarkdown(
      item.description.length > 60 ? item.description.slice(0, 60) + "..." : item.description,
    );
    lines.push(
      `| ${idShort} | ${item.file} | ${item.line} | ${item.type} | ${item.severity} | ${item.age} | ${author} | ${desc} |`,
    );
  }

  lines.push("");

  // Summary by type
  if (stats) {
    lines.push("## Summary by Type");
    lines.push("");
    lines.push("| Type | Count |");
    lines.push("|------|--------|");
    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      if (count > 0) {
        lines.push(`| ${type} | ${count} |`);
      }
    }
    lines.push("");

    // Summary by severity
    lines.push("## Summary by Severity");
    lines.push("");
    lines.push("| Severity | Count | Weight | Sub-score |");
    lines.push("|----------|--------|-------|----------|");
    for (const [severity, count] of Object.entries(stats.bySeverity).sort((a, b) => {
      const order: Record<string, number> = { critical: 0, major: 1, minor: 2 };
      return (order[a[0]] ?? 0) - (order[b[0]] ?? 0);
    })) {
      const weight = SEVERITY_WEIGHTS[severity as DebtSeverity] ?? 0;
      const subScore = count * weight;
      lines.push(`| ${severity} | ${count} | ${weight} | ${subScore} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Creates a visual tech debt dashboard in Markdown format.
 *
 * The dashboard displays a visual summary with ASCII progress bars
 * for severity distribution, top modules, and oldest items.
 *
 * @param stats Tech debt statistics from getDebtScore()
 * @returns Markdown dashboard string
 *
 * @example
 * ```ts
 * const stats = getDebtScore();
 * console.log(formatDebtDashboard(stats));
 * ```
 */
export function formatDebtDashboard(stats: DebtStats): string {
  const lines: string[] = [];

  lines.push("# Tech Debt Dashboard");
  lines.push("");
  lines.push(`> **Generated:** ${new Date().toISOString()}`);
  lines.push("");

  // Score card
  lines.push("## Debt Score");
  lines.push("");
  lines.push(`\`\`\``);
  const barWidth = 30;
  const maxScore = Math.max(stats.score, 100);
  const filledBars = Math.round((stats.score / maxScore) * barWidth);
  const bar = "█".repeat(filledBars) + "░".repeat(Math.max(0, barWidth - filledBars));
  lines.push(`  Score: ${stats.score} / ${maxScore}`);
  lines.push(`  [${bar}]`);
  lines.push(`  Items: ${stats.total} (${stats.open} open, ${stats.resolved} resolved)`);
  lines.push(`  Average age: ${stats.averageAge} days`);
  lines.push(`\`\`\``);
  lines.push("");

  // Severity breakdown
  lines.push("## Severity Breakdown");
  lines.push("");
  lines.push("```");
  const totalSeverity = stats.bySeverity.critical + stats.bySeverity.major + stats.bySeverity.minor;
  const totalForBar = Math.max(totalSeverity, 1);

  lines.push(formatBar("Critical", stats.bySeverity.critical, totalForBar, 10));
  lines.push(formatBar("Major   ", stats.bySeverity.major, totalForBar, 5));
  lines.push(formatBar("Minor   ", stats.bySeverity.minor, totalForBar, 1));
  lines.push("```");
  lines.push("");

  // Type breakdown
  lines.push("## Type Breakdown");
  lines.push("");
  lines.push("```");
  const totalType = Object.values(stats.byType).reduce((a, b) => a + b, 0);
  const totalTypeForBar = Math.max(totalType, 1);
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      lines.push(formatBar(padEnd(type, 14), count, totalTypeForBar));
    }
  }
  lines.push("```");
  lines.push("");

  // Top modules
  const modules = Object.entries(stats.byModule).sort((a, b) => b[1] - a[1]);
  if (modules.length > 0) {
    lines.push("## Top Modules (top 5)");
    lines.push("");
    lines.push("```");
    const maxModuleCount = Math.max(modules[0][1], 1);
    for (const [mod, count] of modules.slice(0, 5)) {
      lines.push(formatBar(padEnd(mod, 20), count, maxModuleCount));
    }
    lines.push("```");
    lines.push("");
  }

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total item | ${stats.total} |`);
  lines.push(`| Open | ${stats.open} |`);
  lines.push(`| Resolved | ${stats.resolved} |`);
  lines.push(`| Debt score | ${stats.score} |`);
  lines.push(`| Average age | ${stats.averageAge} days |`);
  lines.push(`| Critical items | ${stats.bySeverity.critical} |`);
  lines.push(`| Major items | ${stats.bySeverity.major} |`);
  lines.push(`| Minor items | ${stats.bySeverity.minor} |`);

  return lines.join("\n");
}

// ─── Format Helpers ───────────────────────────────────────────────────

/**
 * Creates a horizontal ASCII progress bar.
 *
 * @param label Label for this row
 * @param value Current value
 * @param max Maximum value (for proportion)
 * @param weight Display weight (for spacing)
 * @returns Row string with progress bar
 */
function formatBar(label: string, value: number, max: number, weight?: number): string {
  const barMax = 20;
  const filled = max > 0 ? Math.round((value / max) * barMax) : 0;
  const bar = "▓".repeat(filled) + "░".repeat(barMax - filled);
  const weightStr = weight !== undefined ? ` (×${weight})` : "";
  return `  ${label} ${bar} ${value}${weightStr}`;
}

/**
 * Pads a string with spaces on the right to a given length.
 *
 * @param str String to pad
 * @param len Target length
 * @returns Padded string
 */
function padEnd(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

/**
 * Escapes characters that have special meaning in Markdown.
 *
 * @param text Text to escape
 * @returns Escaped text
 */
// ─── Cleanup ──────────────────────────────────────────────────────────

/**
 * Removes debt items that have been resolved for more than `daysOld` days.
 *
 * Useful for cleaning up history from old items that are no longer relevant.
 *
 * @param daysOld Minimum resolved age (in days) for deletion
 * @returns Number of items deleted
 *
 * @example
 * ```ts
 * const deleted = cleanResolvedDebts(90); // Remove resolved >90 days
 * console.log(`${deleted} items cleaned up`);
 * ```
 */
export function cleanResolvedDebts(daysOld: number = 90): number {
  const items = loadItems();
  const now = Date.now();
  const cutoff = daysOld * 86_400_000;

  const filtered = items.filter((item) => {
    if (item.status !== "resolved") return true;
    if (!item.resolvedAt) return true;
    const resolvedTime = new Date(item.resolvedAt).getTime();
    return now - resolvedTime < cutoff;
  });

  const deleted = items.length - filtered.length;
  if (deleted > 0) {
    saveItems(filtered);
    appendHistory({ event: "clean", deleted, daysOld });
  }

  return deleted;
}

/**
 * Resets all tech debt data.
 *
 * Removes all items from storage. Use with caution.
 *
 * @returns Boolean true if successful
 */
export function resetAllDebts(): boolean {
  try {
    const dir = ensureStorageDir();
    writeFileSync(join(dir, ITEMS_FILE), "[]", "utf-8");
    appendHistory({ event: "reset" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Exports all tech debt data as JSON.
 *
 * @returns JSON string parseable by CLI
 *
 * @example
 * ```ts
 * const json = exportDebtJSON();
 * console.log(json); // output to stdout
 * ```
 */
export function exportDebtJSON(): string {
  const items = loadItems();
  const stats = getDebtScore();

  return JSON.stringify(
    {
      items,
      stats,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}
