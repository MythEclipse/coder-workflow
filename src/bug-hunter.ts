#!/usr/bin/env node
/**
 * Bug Hunter — Automatic bug pattern detector for source code.
 *
 * Scans files, directories, and git diffs to detect patterns known
 * as common bug sources. Detection results are stored in JSONL format
 * in .claude/bug-hunter/findings.jsonl for further analysis.
 *
 * Architecture:
 * 1. Built-in patterns cover 6 categories: null-safety, error-handling,
 *    boundary, security, async, performance.
 * 2. scan*() functions scan content and match against active patterns.
 * 3. Results are saved to a JSONL file for persistence.
 * 4. Format*() functions produce human-readable output.
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
import { join, resolve } from "node:path";
import { ensureDir } from "./utils/index.js";

// ─── Types ───────────────────────────────────────────────────────────────
/**
 * Representation of a bug pattern category.
 */
export type BugCategory =
  | "null-safety"
  | "error-handling"
  | "boundary"
  | "security"
  | "async"
  | "state"
  | "performance";

/**
 * Representation of a bug severity level.
 */
export type BugSeverity = "critical" | "high" | "medium" | "low";

/**
 * Representation of a bug pattern to detect.
 */
export interface BugPattern {
  /** Unique identifier for this pattern (used for suppression) */
  id: string;
  /** Descriptive name of the bug pattern */
  name: string;
  /** Brief explanation of this pattern */
  description: string;
  /** Severity level */
  severity: BugSeverity;
  /** Pattern regex or string literal to match against code */
  pattern: RegExp;
  /** Relevant programming languages */
  languages: string[];
  /** Pattern category */
  category: BugCategory;
  /** General fix suggestion */
  suggestedFix: string;
  /** Whether the pattern is active (can be suppressed) */
  active: boolean;
}

/**
 * Representation of a single bug finding in a file.
 */
export interface BugFinding {
  /** Path to the file where the bug was found */
  file: string;
  /** Line number where the pattern matched */
  line: number;
  /** ID of the matched pattern */
  pattern: string;
  /** Severity level */
  severity: BugSeverity;
  /** Description of the finding */
  description: string;
  /** Specific fix suggestion for this finding */
  suggestedFix: string;
  /** Content of the problematic line */
  content: string;
  /** Detection timestamp */
  timestamp: string;
}

/**
 * Complete bug report for a single scan session.
 */
export interface BugReport {
  /** Total number of findings */
  totalFindings: number;
  /** List of findings */
  findings: BugFinding[];
  /** Breakdown by severity */
  bySeverity: Record<string, number>;
  /** Breakdown by category */
  byCategory: Record<string, number>;
  /** Breakdown by file */
  byFile: Record<string, number>;
  /** Number of files scanned */
  filesScanned: number;
  /** Report timestamp */
  timestamp: string;
}

/**
 * Statistics from historical storage.
 */
export interface BugHunterStats {
  /** Total findings of all time */
  totalFindings: number;
  /** Number of files ever scanned */
  totalFilesScanned: number;
  /** Unresolved findings */
  unresolvedFindings: number;
  /** Active patterns */
  activePatterns: number;
  /** Suppressed patterns */
  suppressedPatterns: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

const STORAGE_DIR = ".claude/bug-hunter";
const FINDINGS_FILE = "findings.jsonl";
const SUPPRESSED_FILE = "suppressed.json";

/**
 * Supported file extensions for scanning.
 */
const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".cpp",
  ".c",
  ".h",
]);

/**
 * Directories always skipped during scan.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "build",
  ".next",
  "vendor",
  ".gradle",
  "generated",
  "coverage",
  ".claude",
]);

// ─── Built-in Bug Patterns (minimal 15) ─────────────────────────────────

/**
 * Returns the list of built-in bug patterns to detect.
 * Covers 6 categories with more than 15 patterns total.
 *
 * @returns {BugPattern[]} List of default bug patterns
 */
export function getBugPatterns(): BugPattern[] {
  return [
    // ── Null Safety ────────────────────────────────────────────────────
    {
      id: "null-nullable-no-check",
      name: "Nullable without null check",
      description:
        "Accessing properties or methods of a nullable value without performing a null check first",
      severity: "critical",
      pattern: /\b(\w+)(\.\w+)+\b(?!\s*\?\.)(?<![?!])/,
      languages: ["ts", "js", "kt", "swift"],
      category: "null-safety",
      suggestedFix: "Use optional chaining (?.) or add a null guard (if/guard) before access",
      active: false,
    },
    {
      id: "null-bang-without-guard",
      name: "Non-null assertion (!) without guard",
      description:
        "Using the non-null assertion operator (!) without ensuring the value is not null beforehand",
      severity: "high",
      pattern: /\b\w+!\s*\./,
      languages: ["ts"],
      category: "null-safety",
      suggestedFix: "Use optional chaining (?.) or validate with an if statement first",
      active: true,
    },
    {
      id: "null-assign-nullable-to-nonnull",
      name: "Nullable assigned to non-null without check",
      description: "Assigning a nullable value to a non-null variable without validation",
      severity: "high",
      pattern: /const\s+\w+\s*[=:]\s*\w+\??\./,
      languages: ["ts", "js", "kt"],
      category: "null-safety",
      suggestedFix:
        "Use null coalescing (??) with a default value or add a null check before assignment",
      active: true,
    },

    // ── Error Handling ─────────────────────────────────────────────────
    {
      id: "err-empty-catch",
      name: "Empty catch block",
      description: "An empty catch block swallows errors without handling or logging",
      severity: "medium",
      pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
      languages: ["ts", "js", "java", "kt", "cpp", "swift", "rb", "php"],
      category: "error-handling",
      suggestedFix:
        "Log the error to console or re-throw with a more descriptive message. Do not leave catch blocks empty.",
      active: true,
    },
    {
      id: "err-promise-without-catch",
      name: "Promise without .catch()",
      description: "Calling a Promise without adding .catch() to handle rejection",
      severity: "high",
      pattern: /\.then\s*\([^)]*\)\s*(?!\s*\.\s*catch\b)/,
      languages: ["ts", "js"],
      category: "error-handling",
      suggestedFix: "Add a .catch() handler at the end of the Promise chain to handle rejection",
      active: false,
    },
    {
      id: "err-async-without-try",
      name: "Async function without try/catch",
      description:
        "An async function that does not have a try/catch block to handle promise rejection",
      severity: "medium",
      pattern: /async\s+(?:function\s+\w+\s*)?\([^)]*\)\s*\{[^}]*(?!try)/,
      languages: ["ts", "js", "py"],
      category: "error-handling",
      suggestedFix: "Wrap the code in a try/catch block to handle potential rejection",
      active: false,
    },
    {
      id: "err-throw-literal",
      name: "Throw non-Error literal",
      description:
        "Throwing an exception with a non-Error type (string, number, object) that loses stack trace information",
      severity: "medium",
      pattern: /throw\s+(['"`]|\d+|null\b|undefined\b)/,
      languages: ["ts", "js", "java", "kt", "cpp"],
      category: "error-handling",
      suggestedFix: "Use 'throw new Error(\"...\")' so the stack trace is properly recorded",
      active: true,
    },

    // ── Boundary ───────────────────────────────────────────────────────
    {
      id: "bnd-array-index-without-length",
      name: "Array index access without length check",
      description: "Accessing an array element by index without checking the array length first",
      severity: "high",
      pattern: /\b\w+\[\s*\w+\s*\]/,
      languages: ["ts", "js", "java", "kt", "go", "rs", "cpp", "py", "rb", "php"],
      category: "boundary",
      suggestedFix:
        "Check the array length (array.length) before accessing an index, or use optional chaining with array.at()",
      active: false,
    },
    {
      id: "bnd-division-without-zero-guard",
      name: "Division without zero guard",
      description: "A division operation without checking whether the divisor is zero",
      severity: "critical",
      pattern: /\b\w+\s*\/\s*\w+\b/,
      languages: ["ts", "js", "java", "kt", "go", "rs", "cpp", "py", "rb", "php"],
      category: "boundary",
      suggestedFix: "Add a guard clause to ensure the divisor is not zero before dividing",
      active: false,
    },
    {
      id: "bnd-substring-without-length",
      name: "Substring/Substr without boundary check",
      description: "Slicing a string using substring/substr without checking the string length",
      severity: "medium",
      pattern: /\.substring\s*\(|\.substr\s*\(|\.slice\s*\(/,
      languages: ["ts", "js", "java", "kt"],
      category: "boundary",
      suggestedFix:
        "Ensure the string length meets the minimum required before slicing, or use Math.min() to clamp boundaries",
      active: true,
    },

    // ── Security ───────────────────────────────────────────────────────
    {
      id: "sec-sql-concatenation",
      name: "SQL string concatenation",
      description:
        "Building SQL queries with string concatenation that is vulnerable to SQL injection",
      severity: "critical",
      pattern: /(?:query|execute|run)\s*\(\s*[`'"]\s*\+\s*/,
      languages: ["ts", "js", "py", "rb", "php", "java", "go"],
      category: "security",
      suggestedFix: "Use parameterized queries / prepared statements to avoid SQL injection",
      active: true,
    },
    {
      id: "sec-eval-usage",
      name: "Usage of eval() or Function()",
      description:
        "Using eval() or the Function() constructor which executes strings as code — extremely dangerous",
      severity: "critical",
      pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
      languages: ["ts", "js", "py"],
      category: "security",
      suggestedFix:
        "Avoid eval(). Use a safe parser or an alternative approach for runtime evaluation needs",
      active: true,
    },
    {
      id: "sec-innerhtml",
      name: "innerHTML / outerHTML assignment",
      description: "Assigning user input directly to innerHTML which is vulnerable to XSS attacks",
      severity: "critical",
      pattern: /\.innerHTML\s*=|\.outerHTML\s*=|\.insertAdjacentHTML\s*\(/,
      languages: ["ts", "js", "tsx", "jsx"],
      category: "security",
      suggestedFix:
        "Use textContent for plain text, or sanitize input first before inserting into innerHTML",
      active: true,
    },
    {
      id: "sec-hardcoded-secret",
      name: "Hardcoded credential/secret",
      description: "Credentials, API keys, or tokens hardcoded directly in source code",
      severity: "critical",
      pattern:
        /(?:api[_-]?key|apikey|secret|password|token|credential)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
      languages: ["ts", "js", "py", "go", "rs", "java", "rb", "php"],
      category: "security",
      suggestedFix: "Use environment variables or a secret management service to store credentials",
      active: true,
    },

    // ── Async ──────────────────────────────────────────────────────────
    {
      id: "async-callback-without-error",
      name: "Callback without error argument",
      description:
        "A callback function that does not have an error parameter (Node.js callback convention)",
      severity: "medium",
      pattern: /\bcb\s*\([^)]*\w+\s*\)|\bcallback\s*\([^)]*\w+\s*\)/,
      languages: ["ts", "js"],
      category: "async",
      suggestedFix:
        "Follow the Node.js callback convention: callback(error, result). The error parameter must be present to handle failure.",
      active: true,
    },
    {
      id: "async-missing-await",
      name: "Missing await on Promise call",
      description:
        "Calling an async function without await, so the Promise is not resolved before use",
      severity: "high",
      pattern:
        /(?:await\s+)?\b\w+\s*=\s*\w+\([^)]*\)\s*;\s*\n\s*\w+\.(?:then|catch|finally)\b(?!.*\bawait\b)/,
      languages: ["ts", "js"],
      category: "async",
      suggestedFix: "Add await before calling the async function, or use a .then() chain",
      active: true,
    },
    {
      id: "async-promise-in-promise",
      name: "Nested Promise inside Promise",
      description: "Creating a new Promise inside another Promise executor causing callback hell",
      severity: "low",
      pattern: /new\s+Promise\s*\([^)]*\)[^;]*\bnew\s+Promise\b/,
      languages: ["ts", "js"],
      category: "async",
      suggestedFix: "Use Promise chaining (.then()) or async/await to avoid nested Promises",
      active: true,
    },

    // ── Performance ────────────────────────────────────────────────────
    {
      id: "perf-nested-loops",
      name: "Potential nested loop O(n²)",
      description:
        "Nested loops (for/forEach) that potentially run in O(n²) and could become a bottleneck",
      severity: "low",
      pattern: /(?:for\s*\([^)]+\)[\s\S]*?for\s*\(|forEach\s*\([^)]*\)[\s\S]*?forEach\s*\()/,
      languages: ["ts", "js", "java", "kt", "go", "rs", "cpp", "py", "rb", "php"],
      category: "performance",
      suggestedFix: "Use Map/Set for O(1) lookups or restructure the algorithm to avoid O(n²)",
      active: true,
    },
    {
      id: "perf-large-array-spread",
      name: "Large array spread operator",
      description:
        "Using the spread operator (...) to concatenate large arrays, allocating new memory",
      severity: "low",
      pattern: /\[\s*\.\.\.\s*\w+\s*,\s*\.\.\.\s*\w+/,
      languages: ["ts", "js", "tsx", "jsx"],
      category: "performance",
      suggestedFix: "Use .push() with spread or array mutation methods for very large arrays",
      active: true,
    },
  ];
}

// ─── Storage Functions ────────────────────────────────────────────────────

/**
 * Ensures the bug-hunter storage directory exists.
 * Creates the directory if it does not exist.
 *
 * @returns {string} Absolute path to the storage directory
 */
function ensureStorageDir(): string {
  return ensureDir(join(process.cwd(), STORAGE_DIR));
}

/**
 * Loads the list of suppressed pattern IDs from storage.
 *
 * @returns {string[]} List of disabled pattern IDs
 */
function loadSuppressedPatterns(): string[] {
  const dir = ensureStorageDir();
  const filePath = join(dir, SUPPRESSED_FILE);

  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    return JSON.parse(content) as string[];
  } catch {
    return [];
  }
}

/**
 * Saves the list of suppressed pattern IDs to storage.
 *
 * @param {string[]} ids - List of disabled pattern IDs
 */
function saveSuppressedPatterns(ids: string[]): void {
  const dir = ensureStorageDir();
  writeFileSync(join(dir, SUPPRESSED_FILE), JSON.stringify(ids, null, 2), "utf-8");
}

// ─── Pattern Management ───────────────────────────────────────────────────

/**
 * Disables a specific pattern from detection.
 * Suppressed pattern IDs are saved to .claude/bug-hunter/suppressed.json.
 *
 * @param {string} patternId - ID of the pattern to disable
 * @throws {Error} If patternId is not found in the built-in patterns list
 */
export function suppressPattern(patternId: string): void {
  const patterns = getBugPatterns();
  const exists = patterns.some((p) => p.id === patternId);

  if (!exists) {
    throw new Error(
      `Pattern with ID "${patternId}" not found. Use getBugPatterns() to see the list of available patterns.`,
    );
  }

  const suppressed = loadSuppressedPatterns();
  if (!suppressed.includes(patternId)) {
    suppressed.push(patternId);
    saveSuppressedPatterns(suppressed);
  }
}

/**
 * Re-enables a previously suppressed pattern.
 *
 * @param {string} patternId - ID of the pattern to re-enable
 */
export function unsuppressPattern(patternId: string): void {
  const suppressed = loadSuppressedPatterns().filter((id) => id !== patternId);
  saveSuppressedPatterns(suppressed);
}

/**
 * Returns the list of active patterns (not suppressed).
 *
 * @returns {BugPattern[]} List of patterns active for detection
 */
function getActivePatterns(): BugPattern[] {
  const suppressed = new Set(loadSuppressedPatterns());
  return getBugPatterns().filter((p) => p.active && !suppressed.has(p.id));
}

// ─── Core Scanning Logic ──────────────────────────────────────────────────

/**
 * Checks whether a file extension is supported for scanning.
 *
 * @param {string} filePath - File path
 * @returns {boolean} true if the extension is supported
 */
function isSupportedFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Gets the language from a file extension.
 *
 * @param {string} filePath - File path
 * @returns {string} Programming language name
 */
function getLanguageFromExtension(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "ts",
    ".js": "js",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".py": "py",
    ".go": "go",
    ".rs": "rs",
    ".java": "java",
    ".rb": "rb",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kt",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
  };
  return langMap[ext] ?? "";
}

/**
 * Scans a single line of content against all active patterns.
 *
 * @param {string} content - Line content
 * @param {number} lineNumber - Line number (1-based)
 * @param {string} filePath - Source file path
 * @param {string} language - Programming language
 * @param {BugPattern[]} patterns - List of active patterns
 * @returns {BugFinding[]} Matched findings for this line
 */
function scanLine(
  content: string,
  lineNumber: number,
  filePath: string,
  language: string,
  patterns: BugPattern[],
): BugFinding[] {
  const findings: BugFinding[] = [];

  for (const pattern of patterns) {
    // Skip if language is not relevant
    if (!pattern.languages.includes(language) && !pattern.languages.includes("*")) continue;

    try {
      if (pattern.pattern.test(content)) {
        findings.push({
          file: filePath,
          line: lineNumber,
          pattern: pattern.id,
          severity: pattern.severity,
          description: pattern.description,
          suggestedFix: pattern.suggestedFix,
          content: content.trim(),
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Skip patterns whose regex has an error
      continue;
    }
  }

  return findings;
}

// ─── Public Scan Functions ────────────────────────────────────────────────

/**
 * Scans git diff content for bug patterns.
 * Useful for pre-commit hooks and code review.
 *
 * @param {string} diffContent - Git diff content (output from git diff)
 * @param {string} language - Programming language (ts, js, py, etc.)
 * @returns {BugFinding[]} List of bug findings in the diff
 */
export function scanDiffForBugs(diffContent: string, language: string): BugFinding[] {
  const findings: BugFinding[] = [];
  const patterns = getActivePatterns();

  if (!diffContent || !language) {
    return findings;
  }

  try {
    const lines = diffContent.split("\n");
    let currentFile = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track the file currently being diffed
      const fileMatch = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        continue;
      }

      // Only scan added lines (prefixed with +)
      if (!line.startsWith("+") || line.startsWith("+++")) continue;

      const contentLine = line.slice(1).trim(); // strip leading +
      if (!contentLine) continue;

      const lineFindings = scanLine(contentLine, i + 1, currentFile, language, patterns);
      findings.push(...lineFindings);
    }
  } catch (error) {
    // Silent fail - return findings collected so far
  }

  return findings;
}

/**
 * Scans a single file for bug patterns.
 * Reads the file from disk and checks each line against active patterns.
 *
 * @param {string} filePath - Absolute path to the file to scan
 * @returns {BugFinding[]} List of bug findings in the file
 */
export function scanFileForBugs(filePath: string): BugFinding[] {
  const findings: BugFinding[] = [];

  try {
    // Validate file
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    if (!isSupportedFile(filePath)) {
      return findings;
    }

    const language = getLanguageFromExtension(filePath);
    const patterns = getActivePatterns();
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const lineFindings = scanLine(line, i + 1, filePath, language, patterns);
      findings.push(...lineFindings);
    }

    // Save findings to storage
    if (findings.length > 0) {
      appendFindings(findings);
    }
  } catch (error) {
    // Re-throw so the caller can handle it
    throw error;
  }

  return findings;
}

/**
 * Scans an entire directory for bug patterns.
 * Recursively finds files with supported extensions.
 *
 * @param {string} dirPath - Absolute path to the directory to scan
 * @returns {BugFinding[]} List of bug findings across the directory
 */
export function scanDirectoryForBugs(dirPath: string): BugFinding[] {
  const allFindings: BugFinding[] = [];

  try {
    const resolvedPath = resolve(dirPath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const files = walkFiles(resolvedPath);

    for (const file of files) {
      try {
        const fileFindings = scanFileForBugs(file);
        allFindings.push(...fileFindings);
      } catch {
        // Skip files that failed to scan
        continue;
      }
    }
  } catch (error) {
    throw error;
  }

  return allFindings;
}

/**
 * Recursively collects supported files from a directory.
 *
 * @param {string} root - Root directory path
 * @returns {string[]} List of discovered file paths
 */
function walkFiles(root: string): string[] {
  const result: string[] = [];

  try {
    const entries = readdirSync(root);

    for (const entry of entries) {
      // Skip dotfiles
      if (entry.startsWith(".")) continue;

      const full = join(root, entry);
      let stats;

      try {
        stats = statSync(full);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        result.push(...walkFiles(full));
      } else if (stats.isFile() && isSupportedFile(full)) {
        result.push(full);
      }
    }
  } catch {
    // Return results collected so far
  }

  return result;
}

// ─── Storage ──────────────────────────────────────────────────────────────

/**
 * Saves findings to the JSONL storage file.
 *
 * @param {BugFinding[]} findings - List of findings to save
 */
function appendFindings(findings: BugFinding[]): void {
  const dir = ensureStorageDir();
  const filePath = join(dir, FINDINGS_FILE);

  try {
    for (const finding of findings) {
      appendFileSync(filePath, JSON.stringify(finding) + "\n", "utf-8");
    }
  } catch {
    // Non-critical — still return findings even if saving fails
  }
}

/**
 * Reads all findings from the JSONL storage file.
 *
 * @param {object} [options] - Filter options
 * @param {BugSeverity} [options.severity] - Filter by severity
 * @param {number} [options.limit] - Maximum number of findings to return
 * @returns {BugFinding[]} List of findings from storage
 */
export function getStoredFindings(options?: {
  severity?: BugSeverity;
  limit?: number;
}): BugFinding[] {
  const dir = ensureStorageDir();
  const filePath = join(dir, FINDINGS_FILE);

  if (!existsSync(filePath)) return [];

  const findings: BugFinding[] = [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const finding = JSON.parse(line) as BugFinding;

        if (options?.severity && finding.severity !== options.severity) continue;

        findings.push(finding);
      } catch {
        // Skip corrupted lines
        continue;
      }
    }
  } catch {
    // Return empty if read fails
  }

  // Sort by timestamp descending
  findings.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return options?.limit ? findings.slice(0, options.limit) : findings;
}

// ─── Report Building ──────────────────────────────────────────────────────

/**
 * Builds a bug report from a list of findings.
 *
 * @param {BugFinding[]} findings - List of findings
 * @param {number} [filesScanned=0] - Number of files scanned
 * @returns {BugReport} Structured bug report
 */
export function buildReport(findings: BugFinding[], filesScanned: number = 0): BugReport {
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byFile: Record<string, number> = {};

  // Get category data from patterns
  const patternCategories = new Map<string, BugCategory>();
  for (const pattern of getBugPatterns()) {
    patternCategories.set(pattern.id, pattern.category);
  }

  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byFile[finding.file] = (byFile[finding.file] ?? 0) + 1;

    const category = patternCategories.get(finding.pattern) ?? "unknown";
    byCategory[category] = (byCategory[category] ?? 0) + 1;
  }

  return {
    totalFindings: findings.length,
    findings,
    bySeverity,
    byCategory,
    byFile,
    filesScanned,
    timestamp: new Date().toISOString(),
  };
}

// ─── Format Functions ─────────────────────────────────────────────────────

/**
 * Formats a single bug finding as a human-readable string.
 *
 * @param {BugFinding} finding - The finding to format
 * @returns {string} String representation of the finding
 */
export function formatFinding(finding: BugFinding): string {
  const severityTag = getSeverityTag(finding.severity);

  return [
    `${severityTag} [${finding.pattern}] ${finding.file}:${finding.line}`,
    `     Description: ${finding.description}`,
    `     Code:        ${finding.content}`,
    `     Suggestion:  ${finding.suggestedFix}`,
  ].join("\n");
}

/**
 * Formats a list of findings into a complete human-readable report.
 *
 * @param {BugFinding[]} findings - List of findings
 * @param {number} [filesScanned=0] - Number of files scanned
 * @returns {string} Complete report as a formatted string
 */
export function formatBugReport(findings: BugFinding[], filesScanned: number = 0): string {
  if (findings.length === 0) {
    return [
      "# Bug Hunter Report",
      "",
      "**No bug patterns detected.**",
      "",
      `Files scanned: ${filesScanned}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join("\n");
  }

  const report = buildReport(findings, filesScanned);
  const lines: string[] = [];

  lines.push("# Bug Hunter Report");
  lines.push("");
  lines.push(`**Total findings:** ${report.totalFindings}`);
  lines.push(`**Files scanned:** ${report.filesScanned}`);
  lines.push(`**Timestamp:** ${report.timestamp}`);
  lines.push("");

  // Summary by severity
  lines.push("## Summary by Severity");
  lines.push("| Severity | Count |");
  lines.push("|----------|--------|");
  const severityOrder: BugSeverity[] = ["critical", "high", "medium", "low"];
  for (const sev of severityOrder) {
    const count = report.bySeverity[sev] ?? 0;
    if (count > 0) {
      lines.push(`| ${getSeverityLabel(sev)} | ${count} |`);
    }
  }
  lines.push("");

  // Summary by category
  lines.push("## Summary by Category");
  lines.push("| Category | Count |");
  lines.push("|----------|--------|");
  const categoryLabels: Record<string, string> = {
    "null-safety": "Null Safety",
    "error-handling": "Error Handling",
    boundary: "Boundary Check",
    security: "Security",
    async: "Async Operations",
    state: "State Management",
    performance: "Performance",
  };
  for (const [cat, count] of Object.entries(report.byCategory).sort((a, b) => b[1] - a[1])) {
    const label = categoryLabels[cat] ?? cat;
    lines.push(`| ${label} | ${count} |`);
  }
  lines.push("");

  // Breakdown by file (top 10)
  lines.push("## By File (Top 10)");
  lines.push("| File | Findings |");
  lines.push("|------|--------|");
  const topFiles = Object.entries(report.byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [file, count] of topFiles) {
    lines.push(`| ${file} | ${count} |`);
  }
  lines.push("");

  // Finding details
  lines.push("## Finding Details");
  for (const finding of findings) {
    lines.push("");
    lines.push(formatFinding(finding));
  }

  return lines.join("\n");
}

/**
 * Gets a severity tag for display in output.
 *
 * @param {BugSeverity} severity - Severity level
 * @returns {string} Severity tag as a formatted string
 */
function getSeverityTag(severity: BugSeverity): string {
  const tags: Record<BugSeverity, string> = {
    critical: "[CRITICAL]",
    high: "[HIGH]",
    medium: "[MEDIUM]",
    low: "[LOW]",
  };
  return tags[severity] ?? "[UNKNOWN]";
}

/**
 * Gets a more descriptive severity label.
 *
 * @param {BugSeverity} severity - Severity level
 * @returns {string} Severity label
 */
function getSeverityLabel(severity: BugSeverity): string {
  const labels: Record<BugSeverity, string> = {
    critical: "Critical — must be fixed immediately",
    high: "High — high priority",
    medium: "Medium — needs attention",
    low: "Low — best practice",
  };
  return labels[severity] ?? severity;
}

// ─── Stats ────────────────────────────────────────────────────────────────

/**
 * Gets statistics from bug-hunter storage.
 *
 * @returns {BugHunterStats} Complete statistics
 */
export function getBugHunterStats(): BugHunterStats {
  const findings = getStoredFindings();
  const suppressed = loadSuppressedPatterns();
  const allPatterns = getBugPatterns();

  // Count unresolved findings (those with high/critical severity)
  const unresolvedFindings = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;

  // Estimate unique files from stored findings
  const uniqueFiles = new Set(findings.map((f) => f.file));

  return {
    totalFindings: findings.length,
    totalFilesScanned: uniqueFiles.size,
    unresolvedFindings,
    activePatterns: allPatterns.filter((p) => p.active).length - suppressed.length,
    suppressedPatterns: suppressed.length,
  };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────

/**
 * CLI entry point. Processes command line arguments and
 * executes the requested operation.
 *
 * Supported arguments:
 * - file <path>: Scan a single file
 * - dir <path>: Scan a directory
 * - diff <lang>: Scan from stdin (diff content)
 * - list: Display the pattern list
 * - suppress <id>: Disable a pattern
 * - unsuppress <id>: Re-enable a pattern
 * - stats: Display statistics
 *
 * @param {string[]} args - CLI arguments
 * @returns {void}
 */
export function main(args: string[]): void {
  const command = args[0]?.toLowerCase();

  try {
    switch (command) {
      case "file": {
        const filePath = args[1];
        if (!filePath) {
          console.error("Usage: bug-hunter file <path>");
          process.exit(1);
        }
        const findings = scanFileForBugs(filePath);
        console.log(formatBugReport(findings, 1));
        break;
      }

      case "dir": {
        const dirPath = args[1] || process.cwd();
        const findings = scanDirectoryForBugs(dirPath);
        console.log(formatBugReport(findings));
        break;
      }

      case "diff": {
        const language = args[1] || "ts";
        let diffContent = "";

        // Read from stdin
        const stdin = readFileSync("/dev/stdin", "utf-8");
        diffContent = stdin;

        const findings = scanDiffForBugs(diffContent, language);
        console.log(formatBugReport(findings));
        break;
      }

      case "list": {
        const patterns = getBugPatterns();
        const suppressed = new Set(loadSuppressedPatterns());

        console.log("# Bug Hunter — Pattern List");
        console.log(`\nTotal patterns: ${patterns.length}`);
        console.log(`Active: ${patterns.length - suppressed.size}`);
        console.log(`Suppressed: ${suppressed.size}\n`);

        for (const pattern of patterns) {
          const status = pattern.active && !suppressed.has(pattern.id) ? "[ACTIVE]" : "[OFF]";
          console.log(`${status} ${pattern.id}`);
          console.log(`     Name:        ${pattern.name}`);
          console.log(`     Severity:    ${pattern.severity}`);
          console.log(`     Category:    ${pattern.category}`);
          console.log(`     Languages:   ${pattern.languages.join(", ")}`);
          console.log(`     Description: ${pattern.description}`);
          console.log("");
        }
        break;
      }

      case "suppress": {
        const patternId = args[1];
        if (!patternId) {
          console.error("Usage: bug-hunter suppress <pattern-id>");
          process.exit(1);
        }
        suppressPattern(patternId);
        console.log(`Pattern "${patternId}" has been disabled.`);
        break;
      }

      case "unsuppress": {
        const patternId = args[1];
        if (!patternId) {
          console.error("Usage: bug-hunter unsuppress <pattern-id>");
          process.exit(1);
        }
        unsuppressPattern(patternId);
        console.log(`Pattern "${patternId}" has been re-enabled.`);
        break;
      }

      case "stats": {
        const stats = getBugHunterStats();
        console.log("# Bug Hunter — Statistics");
        console.log(`\nTotal stored findings: ${stats.totalFindings}`);
        console.log(`Files ever scanned:    ${stats.totalFilesScanned}`);
        console.log(`Unresolved findings:   ${stats.unresolvedFindings}`);
        console.log(`Active patterns:       ${stats.activePatterns}`);
        console.log(`Suppressed patterns:   ${stats.suppressedPatterns}`);
        break;
      }

      default: {
        console.log(`
Bug Hunter — Automatic bug pattern detector

Usage:
  bug-hunter file <path>         Scan a single file
  bug-hunter dir [path]          Scan a directory (default: cwd)
  bug-hunter diff <language>     Scan diff from stdin
  bug-hunter list                Display the pattern list
  bug-hunter suppress <id>       Disable a pattern
  bug-hunter unsuppress <id>     Re-enable a pattern
  bug-hunter stats               Display storage statistics

Examples:
  bug-hunter file src/app.ts
  bug-hunter dir src/
  git diff HEAD~1 | bug-hunter diff ts
        `);
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Run CLI if executed directly — esbuild bundle strips this in ESM context
