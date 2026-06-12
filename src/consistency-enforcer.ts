#!/usr/bin/env node
/**
 * Consistency Enforcer
 *
 * Detects, validates, and fixes code pattern inconsistencies
 * across the codebase by:
 * 1. Scanning existing code to extract dominant patterns (project pattern profile)
 * 2. Validating files against the profile to find violations
 * 3. Learning from user edits to improve pattern detection
 * 4. Providing actionable fix suggestions
 *
 * Storage:
 * - .claude/consistency-enforcer/pattern-profile.json — project pattern profile
 * - .claude/consistency-enforcer/violations.log — violation history
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
import { basename, dirname, extname, join, resolve } from "node:path";
import ts from "typescript";
import { escapeRegExp, escapeMarkdown, ensureDir } from "./utils/index.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Project pattern profile describing dominant conventions.
 * Used as a reference for consistency validation.
 */
export interface ProjectPatternProfile {
  /** Naming convention per file type/entity, e.g. { "component": "PascalCase", "function": "camelCase", "file": "kebab-case" } */
  namingConventions: Record<string, string>;
  /** Dominant import style: "default", "named", "mixed" */
  importStyle: string;
  /** Error handling pattern: "try-catch", "callback", "result-type", "mixed" */
  errorHandling: string;
  /** File organization: "feature-based", "type-based", "flat", "mixed" */
  fileOrganization: string;
  /** Preferred libraries in the project */
  preferredLibs: string[];
  /** Component structure: "function", "class", "arrow-function", "mixed" */
  componentStructure: string;
  /** Test pattern: "describe-it", "test", "assert", "vitest", "jest", "mixed" */
  testPattern: string;
  /** Profile creation timestamp */
  createdAt: string;
  /** Profile last update timestamp */
  updatedAt: string;
}

/**
 * A consistency violation found in a file.
 */
export interface ConsistencyViolation {
  /** Unique violation ID */
  id: string;
  /** File path relative to project root */
  file: string;
  /** Line number of the violation (0 if not specific) */
  line: number;
  /** Violation category */
  category:
    | "naming"
    | "import-style"
    | "error-handling"
    | "file-org"
    | "lib-preference"
    | "component-structure"
    | "test-pattern";
  /** Violation description */
  message: string;
  /** Severity: "error" = must fix, "warning" = should fix, "info" = suggestion */
  severity: "error" | "warning" | "info";
  /** Value found */
  actual: string;
  /** Expected value based on profile */
  expected: string;
  /** Detection timestamp */
  detectedAt: string;
}

/**
 * Learning result from user edits.
 */
export interface LearnedPattern {
  /** Pattern learned */
  pattern: string;
  /** Confidence level 0.0 - 1.0 */
  confidence: number;
  /** Pattern category */
  category: string;
  /** Example from user code */
  example: string;
  /** Learning timestamp */
  learnedAt: string;
}

/**
 * Fix suggestion for a violation.
 */
export interface FixSuggestion {
  /** File path needing a fix */
  file: string;
  /** Line number */
  line: number;
  /** Suggested replacement code (if available) */
  suggestedFix: string;
  /** Explanation of why this change is needed */
  rationale: string;
}

/**
 * Consistency report for one or many files.
 */
export interface ConsistencyReport {
  /** Overall consistency score 0-100 */
  score: number;
  /** Total violations found */
  totalViolations: number;
  /** Breakdown by category */
  byCategory: Record<string, number>;
  /** Breakdown by severity */
  bySeverity: Record<string, number>;
  /** List of violations */
  violations: ConsistencyViolation[];
  /** Fix suggestions (if any) */
  suggestions: FixSuggestion[];
  /** Report timestamp */
  generatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Consistency enforcer data storage directory */
const STORAGE_DIR = ".claude/consistency-enforcer";
/** Project pattern profile file */
const PROFILE_FILE = "pattern-profile.json";
/** Violation log file */
const VIOLATIONS_LOG = "violations.log";

/** Recognized file extensions for scanning */
const RECOGNIZED_EXTENSIONS = new Set([
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
  ".scala",
]);

/** Extension to language mapping */
const EXT_TO_LANG: Record<string, string> = {
  ".ts": "TypeScript",
  ".js": "JavaScript",
  ".tsx": "TypeScript React",
  ".jsx": "JavaScript React",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".scala": "Scala",
};

/** Directories always skipped during scanning */
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

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Ensures the storage directory exists, creates it if not.
 */
function ensureStorageDir(): string {
  return ensureDir(join(process.cwd(), STORAGE_DIR));
}

/**
 * Reads a JSON file with error handling.
 */
function readJSON<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return fallback;
  }
}

/**
 * Writes a JSON file with formatting.
 */
function writeJSON(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Determines the naming style of a string.
 * Returns "PascalCase", "camelCase", "snake_case", "kebab-case", "UPPER_CASE", or "unknown".
 */
function detectNamingStyle(name: string): string {
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*$/.test(name)) return "PascalCase";
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*$/.test(name)) return "camelCase";
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name)) return "snake_case";
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) return "kebab-case";
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(name)) return "UPPER_CASE";
  return "unknown";
}

/**
 * Reads file content safely, returns empty string on failure.
 */
function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return "";
  }
}

/**
 * Appends a violation to the violations.log file.
 */
function appendViolationLog(violation: ConsistencyViolation): void {
  try {
    const dir = ensureStorageDir();
    const logPath = join(dir, VIOLATIONS_LOG);
    appendFileSync(logPath, JSON.stringify(violation) + "\n", "utf-8");
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    // logging failed — non-critical
  }
}

/**
 * Resets the violation log (overwrites with new content).
 */
function resetViolationLog(violations: ConsistencyViolation[]): void {
  try {
    const dir = ensureStorageDir();
    const logPath = join(dir, VIOLATIONS_LOG);
    const lines = violations.map((v) => JSON.stringify(v)).join("\n");
    writeFileSync(logPath, lines + (lines ? "\n" : ""), "utf-8");
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    // non-critical
  }
}

/**
 * Reads the stored violation log.
 */
function readViolationLog(): ConsistencyViolation[] {
  try {
    const dir = ensureStorageDir();
    const logPath = join(dir, VIOLATIONS_LOG);
    if (!existsSync(logPath)) return [];
    const raw = readFileSync(logPath, "utf-8");
    const violations: ConsistencyViolation[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        violations.push(JSON.parse(line) as ConsistencyViolation);
      } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
        // skip corrupt entries
      }
    }
    return violations;
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return [];
  }
}

// ─── Project Pattern Detection ─────────────────────────────────────────────

/**
 * Scans a project directory to extract dominant patterns from existing code.
 *
 * This function walks the directory structure, reads source files,
 * and analyzes naming conventions, import styles, error handling patterns,
 * file organization, used libraries, component structure, and test patterns.
 *
 * @param root - Absolute or relative path to the project root
 * @returns ProjectPatternProfile — project pattern profile object
 *
 * @example
 * ```ts
 * const profile = detectProjectPatterns("/path/to/project");
 * console.log(profile.namingConventions);
 * ```
 */
export function detectProjectPatterns(root: string): ProjectPatternProfile {
  const resolvedRoot = resolve(root);
  const defaultProfile: ProjectPatternProfile = {
    namingConventions: {},
    importStyle: "mixed",
    errorHandling: "mixed",
    fileOrganization: "mixed",
    preferredLibs: [],
    componentStructure: "mixed",
    testPattern: "mixed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    // Collect files to analyze
    const files = collectSourceFiles(resolvedRoot);
    if (files.length === 0) {
      return defaultProfile;
    }

    // Statistics for each category
    const namingCounts: Record<string, Record<string, number>> = {};
    let importDefaultCount = 0;
    let importNamedCount = 0;
    let tryCatchCount = 0;
    let callbackCount = 0;
    let resultTypeCount = 0;
    let featureDirs = 0;
    let typeDirs = 0;
    let totalDirs = 0;
    const libUsage: Record<string, number> = {};
    let functionCompCount = 0;
    let classCompCount = 0;
    let arrowFnCompCount = 0;
    let describeItCount = 0;
    let testGlobalCount = 0;
    let assertCount = 0;

    // Detect file organization: look at directory structure
    const dirEntries = collectDirectoryStructure(resolvedRoot);
    totalDirs = dirEntries.total;
    featureDirs = dirEntries.featureDirs;
    typeDirs = dirEntries.typeDirs;

    // Analyze each file
    for (const file of files) {
      const content = readFileSafe(file);
      if (!content) continue;

      const ext = extname(file);
      const lang = EXT_TO_LANG[ext] ?? "Unknown";

      // Initialize naming counter for this language
      if (!namingCounts[lang]) {
        namingCounts[lang] = {
          PascalCase: 0,
          camelCase: 0,
          snake_case: 0,
          "kebab-case": 0,
          UPPER_CASE: 0,
          unknown: 0,
        };
      }

      // Detect naming conventions from identifiers (functions, classes, variables, constants)
      detectNamingFromContent(content, namingCounts[lang], ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx");

      // Detect import style
      const importStats = detectImportStyle(content);
      importDefaultCount += importStats.defaultImports;
      importNamedCount += importStats.namedImports;

      // Detect error handling patterns
      const errorStats = detectErrorHandlingPattern(content);
      tryCatchCount += errorStats.tryCatch;
      callbackCount += errorStats.callback;
      resultTypeCount += errorStats.resultType;

      // Detect libraries used
      const libs = detectUsedLibraries(content);
      for (const lib of libs) {
        libUsage[lib] = (libUsage[lib] ?? 0) + 1;
      }

      // Detect component structure (React components, classes, functions)
      const compStats = detectComponentStructure(content, ext);
      functionCompCount += compStats.functionDeclaration;
      classCompCount += compStats.classDeclaration;
      arrowFnCompCount += compStats.arrowFunction;

      // Detect test patterns
      const testStats = detectTestPattern(content);
      describeItCount += testStats.describeIt;
      testGlobalCount += testStats.testGlobal;
      assertCount += testStats.assert;
    }

    // Calculate dominant naming convention per language
    const namingConventions: Record<string, string> = {};
    for (const [lang, counts] of Object.entries(namingCounts)) {
      let maxCount = 0;
      let dominantStyle = "unknown";
      for (const [style, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          dominantStyle = style;
        }
      }
      if (maxCount > 0) {
        namingConventions[lang] = dominantStyle;
      }
    }

    // Determine dominant import style
    const totalImports = importDefaultCount + importNamedCount;
    let importStyle = "mixed";
    if (totalImports > 0) {
      const defaultRatio = importDefaultCount / totalImports;
      if (defaultRatio > 0.7) importStyle = "default";
      else if (defaultRatio < 0.3) importStyle = "named";
      else importStyle = "mixed";
    }

    // Determine dominant error handling pattern
    const totalErrorPatterns = tryCatchCount + callbackCount + resultTypeCount;
    let errorHandling = "mixed";
    if (totalErrorPatterns > 0) {
      const tryCatchRatio = tryCatchCount / totalErrorPatterns;
      if (tryCatchRatio > 0.7) errorHandling = "try-catch";
      else if (callbackCount > resultTypeCount && callbackCount / totalErrorPatterns > 0.5) {
        errorHandling = "callback";
      } else if (resultTypeCount > callbackCount && resultTypeCount / totalErrorPatterns > 0.5) {
        errorHandling = "result-type";
      }
    }

    // Determine file organization
    let fileOrganization = "mixed";
    if (totalDirs > 0) {
      const featureRatio = featureDirs / totalDirs;
      const typeRatio = typeDirs / totalDirs;
      if (featureRatio > 0.5) fileOrganization = "feature-based";
      else if (typeRatio > 0.5) fileOrganization = "type-based";
      else if (totalDirs < 3) fileOrganization = "flat";
    }

    // Determine most preferred libraries (top 5)
    const preferredLibs = Object.entries(libUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lib]) => lib);

    // Determine dominant component structure
    const totalCompPatterns = functionCompCount + classCompCount + arrowFnCompCount;
    let componentStructure = "mixed";
    if (totalCompPatterns > 0) {
      const fnRatio = functionCompCount / totalCompPatterns;
      const classRatio = classCompCount / totalCompPatterns;
      if (fnRatio > 0.6) componentStructure = "function";
      else if (classRatio > 0.6) componentStructure = "class";
      else if (arrowFnCompCount / totalCompPatterns > 0.6) componentStructure = "arrow-function";
    }

    // Determine dominant test pattern
    const totalTestPatterns = describeItCount + testGlobalCount + assertCount;
    let testPattern = "mixed";
    if (totalTestPatterns > 0) {
      if (describeItCount > testGlobalCount && describeItCount > assertCount) {
        testPattern = "describe-it";
      } else if (testGlobalCount > describeItCount && testGlobalCount > assertCount) {
        testPattern = "test";
      } else if (assertCount > describeItCount && assertCount > testGlobalCount) {
        testPattern = "assert";
      }
    }

    const profile: ProjectPatternProfile = {
      namingConventions,
      importStyle,
      errorHandling,
      fileOrganization,
      preferredLibs,
      componentStructure,
      testPattern,
      createdAt: defaultProfile.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Save profile to storage
    saveProfile(profile);

    return profile;
  } catch (error) {
    // If an error occurs, return the default profile
    return defaultProfile;
  }
}

/**
 * Collects all relevant source files from a directory.
 */
function collectSourceFiles(root: string): string[] {
  const result: string[] = [];

  function walk(dir: string) {
    let dirEntries: string[];
    try {
      dirEntries = readdirSafe(dir);
    } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
      return;
    }

    for (const entry of dirEntries) {
      const full = join(dir, entry);
      try {
        const stat = statSafe(full);
        if (!stat) continue;
        if (stat.isDirectory()) {
          if (SKIP_DIRS.has(entry)) continue;
          walk(full);
        } else if (stat.isFile()) {
          const ext = extname(full);
          if (RECOGNIZED_EXTENSIONS.has(ext)) {
            result.push(full);
          }
        }
      } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
        continue;
      }
    }
  }

  walk(root);
  return result;
}

/**
 * Safely reads directory contents.
 */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return [];
  }
}

/**
 * Safely gets file stats.
 */
function statSafe(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return null;
  }
}

/**
 * Analyzes directory structure to determine file organization.
 */
function collectDirectoryStructure(root: string): {
  total: number;
  featureDirs: number;
  typeDirs: number;
} {
  let total = 0;
  let featureDirs = 0;
  let typeDirs = 0;

  const entries = readdirSafe(root);
  for (const entry of entries) {
    const full = join(root, entry);
    const stat = statSafe(full);
    if (!stat || !stat.isDirectory()) continue;
    if (SKIP_DIRS.has(entry)) continue;

    total++;

    // Feature directories usually contain domain-named files (users, orders, auth)
    if (
      /^(users|orders|auth|payments|products|carts|admin|api|modules|features|domains)/i.test(entry)
    ) {
      featureDirs++;
    }

    // Type-based directories usually contain generic names (components, services, utils, hooks)
    if (
      /^(components|services|utils|hooks|helpers|middlewares|controllers|models|views|templates)/i.test(
        entry,
      )
    ) {
      typeDirs++;
    }
  }

  return { total, featureDirs, typeDirs };
}

/**
 * Detects naming conventions from file content.
 */
function detectNamingFromContent(content: string, counts: Record<string, number>, isTS: boolean = false): void {
  if (isTS) {
    const sourceFile = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true);
    ts.forEachChild(sourceFile, function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node) && node.name) {
        counts.PascalCase = (counts.PascalCase || 0) + 1;
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        const style = detectNamingStyle(node.name.text);
        counts[style] = (counts[style] || 0) + 1;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const style = detectNamingStyle(node.name.text);
        counts[style] = (counts[style] || 0) + 1;
      }
      ts.forEachChild(node, visit);
    });
    return;
  }

  // Fallback to regex for non-TS/JS
  const classMatches = content.match(/\bclass\s+([A-Z][a-zA-Z0-9]+)\b/g);
  if (classMatches) counts.PascalCase += classMatches.length;

  const fnMatches = content.match(/\bfunction\s+([a-zA-Z_$][\w$]+)\b/g);
  if (fnMatches) {
    for (const match of fnMatches) {
      const name = match.replace(/^function\s+/, "");
      const style = detectNamingStyle(name);
      if (counts[style] !== undefined) counts[style]++;
    }
  }

  const constMatches = content.match(/\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*[=:]/g);
  if (constMatches) {
    for (const match of constMatches) {
      const name = match
        .replace(/^(?:const|let|var)\s+/, "")
        .replace(/\s*[=:]\s*$/, "")
        .trim();
      const style = detectNamingStyle(name);
      if (counts[style] !== undefined) counts[style]++;
    }
  }

  const exportMatches = content.match(
    /\bexport\s+(?:const|let|var|function|class|interface|type)\s+([a-zA-Z_$][\w$]*)/g,
  );
  if (exportMatches) {
    for (const match of exportMatches) {
      const name = match.replace(
        /^export\s+(?:const|let|var|function|class|interface|type)\s+/,
        "",
      );
      const style = detectNamingStyle(name);
      if (counts[style] !== undefined) counts[style]++;
    }
  }
}

/**
 * Detects import style (named vs default) from content.
 */
function detectImportStyle(content: string): { defaultImports: number; namedImports: number } {
  let defaultImports = 0;
  let namedImports = 0;

  // Default import: import X from 'y'
  const defaultMatches = content.match(/^import\s+[A-Za-z_$][\w$]*\s+from\s+/gm);
  if (defaultMatches) defaultImports += defaultMatches.length;

  // Named import: import { X } from 'y'
  const namedMatches = content.match(/^import\s+\{[^}]*\}\s+from\s+/gm);
  if (namedMatches) namedImports += namedMatches.length;

  // Multi-line named import: import { \n X \n } from 'y'
  const namedMulti = content.match(/^import\s+\{[\s\S]*?\}\s+from\s+/gm);
  if (namedMulti) namedImports += namedMulti.length - (namedMatches?.length ?? 0);

  // Also detect import * as
  const namespaceMatches = content.match(/^import\s+\*\s+as\s+/gm);
  if (namespaceMatches) defaultImports += namespaceMatches.length;

  return { defaultImports, namedImports };
}

/**
 * Detects error handling patterns from content.
 */
function detectErrorHandlingPattern(content: string): {
  tryCatch: number;
  callback: number;
  resultType: number;
} {
  const tryCatch = (content.match(/\btry\s*\{/g) ?? []).length;
  const callback =
    (content.match(/\(err(?:or)?\s*(?:,|\))/g) ?? []).length +
    (content.match(/\b(err|error)\s*=>/g) ?? []).length;
  const resultType =
    (content.match(/\bResult\b/g) ?? []).length +
    (content.match(/\bOk\b|\bErr\b/g) ?? []).length +
    (content.match(/\bEither\b/g) ?? []).length;

  return { tryCatch, callback, resultType };
}

/**
 * Detects libraries used from import/require statements.
 */
function detectUsedLibraries(content: string): string[] {
  const libs: string[] = [];

  // Find import from 'library-name'
  const importMatches = content.matchAll(/from\s+['"]([^'"/]+)['"]/g);
  for (const match of importMatches) {
    if (match[1] && !match[1].startsWith(".") && !match[1].startsWith("/")) {
      libs.push(match[1]);
    }
  }

  // Find require('library-name')
  const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"/]+)['"]/g);
  for (const match of requireMatches) {
    if (match[1] && !match[1].startsWith(".") && !match[1].startsWith("/")) {
      libs.push(match[1]);
    }
  }

  return libs;
}

/**
 * Detects component structure from content based on file extension.
 */
function detectComponentStructure(
  content: string,
  ext: string,
): { functionDeclaration: number; classDeclaration: number; arrowFunction: number } {
  const functionDeclaration = (content.match(/\bfunction\s+[A-Z][a-zA-Z0-9]*\s*\(/g) ?? []).length;
  const classDeclaration = (content.match(/\bclass\s+[A-Z][a-zA-Z0-9]*/g) ?? []).length;

  // Arrow functions of the form `const X = (...) =>` (potential components)
  const arrowFunction =
    ext === ".tsx" || ext === ".jsx"
      ? (
          content.match(/\bconst\s+[A-Z][a-zA-Z0-9]*\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g) ??
          []
        ).length
      : 0;

  return { functionDeclaration, classDeclaration, arrowFunction };
}

/**
 * Detects test patterns from file content.
 */
function detectTestPattern(content: string): {
  describeIt: number;
  testGlobal: number;
  assert: number;
} {
  const describeIt =
    (content.match(/\bdescribe\s*\(/g) ?? []).length + (content.match(/\bit\s*\(/g) ?? []).length;
  const testGlobal = (content.match(/\btest\s*\(/g) ?? []).length;
  const assert =
    (content.match(/\bassert\s*\./g) ?? []).length +
    (content.match(/\bexpect\s*\(/g) ?? []).length +
    (content.match(/\bassert\s*\(/g) ?? []).length;

  return { describeIt, testGlobal, assert };
}

// ─── Profile Persistence ────────────────────────────────────────────────────

/**
 * Saves the profile to the storage file.
 */
function saveProfile(profile: ProjectPatternProfile): void {
  try {
    const dir = ensureStorageDir();
    writeJSON(join(dir, PROFILE_FILE), profile);
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    // non-critical
  }
}

/**
 * Reads the profile from the storage file.
 *
 * @returns ProjectPatternProfile or null if none exists
 */
export function loadProfile(): ProjectPatternProfile | null {
  try {
    const dir = ensureStorageDir();
    const filePath = join(dir, PROFILE_FILE);
    return readJSON<ProjectPatternProfile | null>(filePath, null);
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return null;
  }
}

/**
 * Removes the profile from storage.
 *
 * @returns true if successfully deleted, false if none existed
 */
export function clearProfile(): boolean {
  try {
    const dir = ensureStorageDir();
    const filePath = join(dir, PROFILE_FILE);
    if (!existsSync(filePath)) return false;
    writeFileSync(filePath, JSON.stringify(null), "utf-8");
    return true;
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return false;
  }
}

// ─── File Validation ────────────────────────────────────────────────────────

/**
 * Validates a file against the project's consistency profile.
 *
 * Reads the file, analyzes its content, and compares it against
 * the patterns defined in the profile. Returns a list of
 * violations found.
 *
 * @param filePath - Absolute path to the file to validate
 * @param profile - ProjectPatternProfile used as reference
 * @returns ConsistencyViolation[] — list of violations (empty if compliant)
 *
 * @example
 * ```ts
 * const violations = validateFileAgainstProfile("/path/to/file.ts", profile);
 * if (violations.length > 0) {
 *   console.log(formatViolationReport(violations));
 * }
 * ```
 */
export function validateFileAgainstProfile(
  filePath: string,
  profile: ProjectPatternProfile,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const now = new Date().toISOString();

  try {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSafe(filePath);
    if (!content) return [];

    const ext = extname(filePath);
    const lang = EXT_TO_LANG[ext] ?? "unknown";

    // 1. Validate naming convention for recognized language
    if (profile.namingConventions[lang]) {
      const expectedStyle = profile.namingConventions[lang];
      const namingViolations = validateNamingConvention(content, expectedStyle, filePath);
      violations.push(...namingViolations);
    }

    // 2. Validate import style
    if (profile.importStyle !== "mixed") {
      const importViolations = validateImportStyle(content, profile.importStyle, filePath);
      violations.push(...importViolations);
    }

    // 3. Validate error handling pattern
    if (profile.errorHandling !== "mixed") {
      const errorViolations = validateErrorHandling(content, profile.errorHandling, filePath);
      violations.push(...errorViolations);
    }

    // 4. Validate library preference
    if (profile.preferredLibs.length > 0) {
      const libViolations = validateLibPreference(content, profile.preferredLibs, filePath);
      violations.push(...libViolations);
    }

    // 5. Validate component structure for tsx/jsx files
    if ((ext === ".tsx" || ext === ".jsx") && profile.componentStructure !== "mixed") {
      const compViolations = validateComponentStructure(
        content,
        profile.componentStructure,
        filePath,
      );
      violations.push(...compViolations);
    }

    // 6. Validate test pattern for test files
    if (isTestFile(filePath) && profile.testPattern !== "mixed") {
      const testViolations = validateTestPattern(content, profile.testPattern, filePath);
      violations.push(...testViolations);
    }

    // Assign unique ID and timestamp to each violation
    const enrichedViolations = violations.map((v) => ({
      ...v,
      id: `violation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      detectedAt: now,
    }));

    // Log violations for history
    for (const v of enrichedViolations) {
      appendViolationLog(v);
    }

    return enrichedViolations;
  } catch (error) {
    // If validation fails entirely, return empty array
    return [];
  }
}

/**
 * Validates multiple files against the project's consistency profile.
 *
 * Calls validateFileAgainstProfile for each file and
 * collects all violations into a single array.
 *
 * @param filePaths - Array of absolute file paths to validate
 * @param profile - ProjectPatternProfile used as reference
 * @returns ConsistencyViolation[] — combined violations from all files
 *
 * @example
 * ```ts
 * const allViolations = validateFilesAgainstProfile(["/a.ts", "/b.ts"], profile);
 * ```
 */
export function validateFilesAgainstProfile(
  filePaths: string[],
  profile: ProjectPatternProfile,
): ConsistencyViolation[] {
  const allViolations: ConsistencyViolation[] = [];

  for (const filePath of filePaths) {
    try {
      const violations = validateFileAgainstProfile(filePath, profile);
      allViolations.push(...violations);
    } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
      // Skip files that fail validation
      continue;
    }
  }

  return allViolations;
}

/**
 * Checks whether a file is a test file based on its name/path.
 */
function isTestFile(filePath: string): boolean {
  const base = basename(filePath);
  return (
    /\.(test|spec|e2e|integration)\.(ts|js|tsx|jsx)$/.test(base) ||
    /\.(test|spec)\.(py|go|rs)$/.test(base) ||
    base.startsWith("test_") ||
    base.endsWith("_test.go") ||
    base.endsWith("_test.rs")
  );
}

/**
 * Validates naming conventions in file content.
 */
function validateNamingConvention(
  content: string,
  expectedStyle: string,
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  // Check classes
  const classRegex = /\bclass\s+([a-zA-Z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    if (expectedStyle === "PascalCase" && !/^[A-Z]/.test(name)) {
      violations.push({
        id: "",
        file: filePath,
        line: countLinesUpTo(content, match.index),
        category: "naming",
        message: `Class name "${name}" should use ${expectedStyle}`,
        severity: "error",
        actual: name,
        expected: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
        detectedAt: "",
      });
    }
  }

  // Check functions/constants for camelCase (if profile requires it)
  if (expectedStyle === "camelCase") {
    const constRegex = /\bconst\s+([A-Z][a-zA-Z0-9]+)\s*[=:]/g;
    while ((match = constRegex.exec(content)) !== null) {
      const name = match[1];
      // Skip UPPER_CASE constants
      if (/^[A-Z0-9_]+$/.test(name)) continue;
      violations.push({
        id: "",
        file: filePath,
        line: countLinesUpTo(content, match.index),
        category: "naming",
        message: `Constant "${name}" should use camelCase, not PascalCase`,
        severity: "warning",
        actual: name,
        expected: `${name.charAt(0).toLowerCase()}${name.slice(1)}`,
        detectedAt: "",
      });
    }
  }

  return violations;
}

/**
 * Validates import style.
 */
function validateImportStyle(
  content: string,
  expectedStyle: string,
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const { defaultImports, namedImports } = detectImportStyle(content);
  const total = defaultImports + namedImports;

  if (total === 0) return violations;

  if (expectedStyle === "named" && defaultImports > namedImports) {
    violations.push({
      id: "",
      file: filePath,
      line: 1,
      category: "import-style",
      message: `Project predominantly uses named imports, but found ${defaultImports} default import(s)`,
      severity: "warning",
      actual: `${defaultImports} default imports`,
      expected: "named imports",
      detectedAt: "",
    });
  }

  if (expectedStyle === "default" && namedImports > defaultImports) {
    violations.push({
      id: "",
      file: filePath,
      line: 1,
      category: "import-style",
      message: `Project predominantly uses default imports, but found ${namedImports} named import(s)`,
      severity: "warning",
      actual: `${namedImports} named imports`,
      expected: "default imports",
      detectedAt: "",
    });
  }

  return violations;
}

/**
 * Validates error handling pattern.
 */
function validateErrorHandling(
  content: string,
  expectedStyle: string,
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const patterns = detectErrorHandlingPattern(content);

  if (patterns.tryCatch === 0 && patterns.callback === 0 && patterns.resultType === 0) {
    return violations;
  }

  if (expectedStyle === "try-catch" && patterns.callback > patterns.tryCatch) {
    violations.push({
      id: "",
      file: filePath,
      line: 1,
      category: "error-handling",
      message: "Project predominantly uses try/catch, but found callback patterns",
      severity: "warning",
      actual: `${patterns.callback} callback patterns`,
      expected: "try/catch",
      detectedAt: "",
    });
  }

  if (expectedStyle === "result-type" && patterns.tryCatch > patterns.resultType) {
    violations.push({
      id: "",
      file: filePath,
      line: 1,
      category: "error-handling",
      message: "Project predominantly uses Result type, but found try/catch",
      severity: "info",
      actual: `${patterns.tryCatch} try/catch blocks`,
      expected: "Result type",
      detectedAt: "",
    });
  }

  return violations;
}

/**
 * Validates library preferences.
 */
function validateLibPreference(
  content: string,
  preferredLibs: string[],
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const usedLibs = detectUsedLibraries(content);

  // List of popular libraries that might be alternatives
  const alternatives: Record<string, string[]> = {
    lodash: ["lodash-es"],
    moment: ["date-fns", "dayjs"],
    axios: ["fetch", "ky"],
    express: ["fastify", "hono"],
    redux: ["zustand", "jotai"],
    "styled-components": ["tailwindcss", "css-modules"],
    enzyme: ["@testing-library/react"],
    mocha: ["vitest", "jest"],
    chai: ["vitest", "jest"],
    sinon: ["vitest", "jest"],
    request: ["node-fetch", "undici"],
    bluebird: ["native-promise"],
  };

  for (const lib of usedLibs) {
    // Check if the used library is in preferences
    if (!preferredLibs.includes(lib)) {
      // Check if there is a preferred alternative
      for (const [preferred, alts] of Object.entries(alternatives)) {
        if (alts.includes(lib) && preferredLibs.includes(preferred)) {
          violations.push({
            id: "",
            file: filePath,
            line: 1,
            category: "lib-preference",
            message: `Library "${lib}" has a preferred alternative: "${preferred}"`,
            severity: "info",
            actual: lib,
            expected: preferred,
            detectedAt: "",
          });
          break;
        }
      }

      // If the library is unknown and not internal, record as info
      if (!lib.startsWith(".") && !preferredLibs.includes(lib)) {
        violations.push({
          id: "",
          file: filePath,
          line: 1,
          category: "lib-preference",
          message: `Library "${lib}" is not in the project preferences: [${preferredLibs.join(", ")}]`,
          severity: "info",
          actual: lib,
          expected: preferredLibs.join(" or "),
          detectedAt: "",
        });
      }
    }
  }

  return violations;
}

/**
 * Validates component structure for React files.
 */
function validateComponentStructure(
  content: string,
  expectedStyle: string,
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const stats = detectComponentStructure(content, extname(filePath));

  const total = stats.functionDeclaration + stats.classDeclaration + stats.arrowFunction;
  if (total === 0) return violations;

  if (expectedStyle === "function" && stats.classDeclaration > stats.functionDeclaration) {
    violations.push({
      id: "",
      file: filePath,
      line: 1,
      category: "component-structure",
      message: `Project uses function components, but found ${stats.classDeclaration} class component(s)`,
      severity: "warning",
      actual: `${stats.classDeclaration} class declarations`,
      expected: "function declarations",
      detectedAt: "",
    });
  }

  if (expectedStyle === "arrow-function" && stats.functionDeclaration > stats.arrowFunction) {
    violations.push({
      id: "",
      file: filePath,
      line: 1,
      category: "component-structure",
      message: "Project uses arrow function components, but found function declarations",
      severity: "info",
      actual: `${stats.functionDeclaration} function declarations`,
      expected: "arrow functions",
      detectedAt: "",
    });
  }

  return violations;
}

/**
 * Validates testing pattern.
 */
function validateTestPattern(
  content: string,
  expectedStyle: string,
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const stats = detectTestPattern(content);

  if (expectedStyle === "describe-it") {
    const hasTestGlobal = stats.testGlobal > stats.describeIt;
    if (hasTestGlobal) {
      violations.push({
        id: "",
        file: filePath,
        line: 1,
        category: "test-pattern",
        message: `Project uses describe/it, but found ${stats.testGlobal} test() call(s)`,
        severity: "warning",
        actual: `${stats.testGlobal} test() calls`,
        expected: "describe/it pattern",
        detectedAt: "",
      });
    }
  }

  return violations;
}

/**
 * Counts the line number from a given index in a string.
 */
function countLinesUpTo(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// ─── Learning from User Edits ───────────────────────────────────────────────

/**
 * Learns patterns from user-made changes.
 *
 * Compares original and edited content to extract
 * patterns that may be user preferences. This function detects
 * changes in naming conventions, import styles, and code structure.
 *
 * @param originalContent - File content before editing
 * @param editedContent - File content after editing
 * @returns LearnedPattern — learned pattern with confidence score
 *
 * @example
 * ```ts
 * const result = learnFromUserEdit(originalCode, editedCode);
 * console.log(`Detected pattern: ${result.pattern} (confidence: ${result.confidence})`);
 * ```
 */
export function learnFromUserEdit(originalContent: string, editedContent: string): LearnedPattern {
  const now = new Date().toISOString();

  try {
    if (!originalContent || !editedContent) {
      return {
        pattern: "no-change",
        confidence: 0,
        category: "unknown",
        example: "",
        learnedAt: now,
      };
    }

    // If identical, nothing to learn
    if (originalContent === editedContent) {
      return {
        pattern: "no-change",
        confidence: 0,
        category: "unknown",
        example: "",
        learnedAt: now,
      };
    }

    // Analyze naming convention changes
    const originalNaming = analyzeNamingChanges(originalContent, editedContent);
    if (originalNaming) {
      return {
        pattern: `naming:${originalNaming.style}`,
        confidence: originalNaming.confidence,
        category: "naming",
        example: originalNaming.example,
        learnedAt: now,
      };
    }

    // Analyze import style changes
    const importChange = analyzeImportStyleChange(originalContent, editedContent);
    if (importChange) {
      return {
        pattern: `import:${importChange.style}`,
        confidence: importChange.confidence,
        category: "import-style",
        example: importChange.example,
        learnedAt: now,
      };
    }

    // Analyze error handling changes
    const errorChange = analyzeErrorHandlingChange(originalContent, editedContent);
    if (errorChange) {
      return {
        pattern: `error-handling:${errorChange.style}`,
        confidence: errorChange.confidence,
        category: "error-handling",
        example: errorChange.example,
        learnedAt: now,
      };
    }

    // No specific pattern detected
    return {
      pattern: "generic-edit",
      confidence: 0.3,
      category: "unknown",
      example: extractChangedSnippet(originalContent, editedContent),
      learnedAt: now,
    };
  } catch (error) {
    return {
      pattern: "error",
      confidence: 0,
      category: "unknown",
      example: "",
      learnedAt: now,
    };
  }
}

/**
 * Analyzes naming convention changes between original and edited content.
 */
function analyzeNamingChanges(
  original: string,
  edited: string,
): { style: string; confidence: number; example: string } | null {
  // Find new identifiers that appear in edited but not in original
  const originalIdentifiers = extractIdentifiers(original);
  const editedIdentifiers = extractIdentifiers(edited);

  const newIdentifiers = editedIdentifiers.filter((id) => !originalIdentifiers.includes(id));

  if (newIdentifiers.length === 0) return null;

  // Calculate naming style distribution for new identifiers
  const styleCounts: Record<string, number> = {};
  for (const id of newIdentifiers) {
    const style = detectNamingStyle(id);
    styleCounts[style] = (styleCounts[style] ?? 0) + 1;
  }

  // Find dominant style
  let dominantStyle = "unknown";
  let maxCount = 0;
  for (const [style, count] of Object.entries(styleCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantStyle = style;
    }
  }

  if (maxCount === 0 || dominantStyle === "unknown") return null;

  const confidence = Math.min(0.5 + (maxCount / newIdentifiers.length) * 0.5, 1.0);
  const example = newIdentifiers.find((id) => detectNamingStyle(id) === dominantStyle) ?? "";

  return { style: dominantStyle, confidence, example };
}

/**
 * Analyzes import style changes.
 */
function analyzeImportStyleChange(
  original: string,
  edited: string,
): { style: string; confidence: number; example: string } | null {
  // Find new imports in edited content
  const originalImports = extractImports(original);
  const editedImports = extractImports(edited);

  const newImports = editedImports.filter((imp) => !originalImports.includes(imp));

  if (newImports.length === 0) return null;

  // Count new import styles
  let defaultCount = 0;
  let namedCount = 0;
  for (const imp of newImports) {
    if (/^[A-Za-z_$][\w$]*\s+from/.test(imp)) defaultCount++;
    else if (/\{/.test(imp)) namedCount++;
  }

  const total = defaultCount + namedCount;
  if (total === 0) return null;

  let style: string;
  let confidence: number;

  if (defaultCount > namedCount) {
    style = "default";
    confidence = Math.round((defaultCount / total) * 100) / 100;
  } else {
    style = "named";
    confidence = Math.round((namedCount / total) * 100) / 100;
  }

  const example = newImports[0];

  return { style, confidence, example };
}

/**
 * Analyzes error handling pattern changes.
 */
function analyzeErrorHandlingChange(
  original: string,
  edited: string,
): { style: string; confidence: number; example: string } | null {
  const originalPatterns = detectErrorHandlingPattern(original);
  const editedPatterns = detectErrorHandlingPattern(edited);

  const tryCatchDiff = editedPatterns.tryCatch - originalPatterns.tryCatch;
  const callbackDiff = editedPatterns.callback - originalPatterns.callback;
  const resultDiff = editedPatterns.resultType - originalPatterns.resultType;

  if (tryCatchDiff > 0 && tryCatchDiff >= callbackDiff && tryCatchDiff >= resultDiff) {
    return { style: "try-catch", confidence: 0.7, example: "try { ... } catch { ... }" };
  }

  if (callbackDiff > 0 && callbackDiff >= tryCatchDiff && callbackDiff >= resultDiff) {
    return { style: "callback", confidence: 0.6, example: "(err, result) => { ... }" };
  }

  if (resultDiff > 0 && resultDiff >= tryCatchDiff && resultDiff >= callbackDiff) {
    return { style: "result-type", confidence: 0.6, example: "Result<T, E>" };
  }

  return null;
}

/**
 * Extracts identifiers (function names, classes, variables) from content.
 */
function extractIdentifiers(content: string): string[] {
  const identifiers = new Set<string>();

  // Classes
  const classMatches = content.matchAll(/\bclass\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of classMatches) identifiers.add(m[1]);

  // Functions
  const fnMatches = content.matchAll(/\bfunction\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of fnMatches) identifiers.add(m[1]);

  // Interface / Type
  const typeMatches = content.matchAll(/\b(?:interface|type)\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of typeMatches) identifiers.add(m[1]);

  // Module-level constants/variables with export
  const constMatches = content.matchAll(/\b(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of constMatches) identifiers.add(m[1]);

  return [...identifiers];
}

/**
 * Extracts import statements from content.
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[0].trim());
  }
  return imports;
}

/**
 * Extracts the code snippet that changed between two versions.
 */
function extractChangedSnippet(original: string, edited: string): string {
  const origLines = original.split("\n");
  const editLines = edited.split("\n");

  // Find first differing line
  for (let i = 0; i < Math.min(origLines.length, editLines.length); i++) {
    if (origLines[i] !== editLines[i]) {
      const start = Math.max(0, i - 1);
      const end = Math.min(editLines.length, i + 4);
      return editLines.slice(start, end).join("\n");
    }
  }

  // If lengths differ, take from the new portion
  if (editLines.length > origLines.length) {
    return editLines.slice(origLines.length).join("\n").slice(0, 200);
  }

  return "";
}

// ─── Fix Suggestions ───────────────────────────────────────────────────────

/**
 * Creates a fix suggestion for a consistency violation.
 *
 * Based on the category and type of violation, this function generates
 * specific and actionable fix suggestions.
 *
 * @param violation - The violation to fix
 * @returns FixSuggestion — detailed fix suggestion
 *
 * @example
 * ```ts
 * const suggestion = suggestFix(violation);
 * console.log(`Fix line ${suggestion.line}: ${suggestion.suggestedFix}`);
 * ```
 */
export function suggestFix(violation: ConsistencyViolation): FixSuggestion {
  try {
    const filePath = violation.file;

    switch (violation.category) {
      case "naming": {
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: `Replace "${violation.actual}" with "${violation.expected}"`,
          rationale: `Follow the project naming convention which uses ${violation.expected}`,
        };
      }

      case "import-style": {
        const isDefaultExpected = violation.expected === "default imports";
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: isDefaultExpected
            ? "Change named imports to default imports: `import X from 'module'`"
            : "Change default imports to named imports: `import { X } from 'module'`",
          rationale: `Be consistent with the dominant import style in this project`,
        };
      }

      case "error-handling": {
        const isTryCatchExpected = violation.expected === "try/catch";
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: isTryCatchExpected
            ? "Wrap code in try/catch block:\n\ttry {\n\t  // code\n\t} catch (error) {\n\t  // handle error\n\t}"
            : "Use Result type pattern:\n\tconst result = await operation();\n\tif (result.isErr()) { ... }",
          rationale: `Be consistent with this project's error handling pattern (${violation.expected})`,
        };
      }

      case "lib-preference": {
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: `Replace import "${violation.actual}" with "${violation.expected}"`,
          rationale: `Library "${violation.expected}" is the established preference for this project`,
        };
      }

      case "component-structure": {
        const useFunction = violation.expected === "function declarations";
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: useFunction
            ? "Change class component to function component:\n\tfunction Component(props) { ... }"
            : "Change function declaration to arrow function:\n\tconst Component = (props) => { ... }",
          rationale: `Be consistent with the component structure used in this project (${violation.expected})`,
        };
      }

      case "test-pattern": {
        return {
          file: filePath,
          line: violation.line,
          suggestedFix:
            "Use describe/it pattern:\n\tdescribe('feature', () => {\n\t  it('should ...', () => { ... });\n\t});",
          rationale: `Be consistent with the test pattern used in this project (${violation.expected})`,
        };
      }

      default:
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: "Review and align with established project patterns",
          rationale: `Violation in category "${violation.category}" needs adjustment`,
        };
    }
  } catch (error) {
    return {
      file: violation.file,
      line: violation.line,
      suggestedFix: "Unable to generate automatic suggestion",
      rationale: "An error occurred while processing the fix suggestion",
    };
  }
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * Calculates the project consistency score based on profile and violations.
 *
 * Score 100 means zero violations. Each violation
 * reduces the score based on its severity: error (-15), warning (-5), info (-1).
 *
 * @param profile - ProjectPatternProfile used as reference
 * @param violations - List of violations found
 * @returns number — consistency score 0-100
 *
 * @example
 * ```ts
 * const score = getConsistencyScore(profile, violations);
 * console.log(`Consistency score: ${score}/100`);
 * ```
 */
export function getConsistencyScore(
  profile: ProjectPatternProfile,
  violations: ConsistencyViolation[],
): number {
  try {
    if (!profile || violations.length === 0) return 100;

    // Calculate total deduction based on severity
    let totalDeduction = 0;
    for (const v of violations) {
      switch (v.severity) {
        case "error":
          totalDeduction += 15;
          break;
        case "warning":
          totalDeduction += 5;
          break;
        case "info":
          totalDeduction += 1;
          break;
      }
    }

    // If the profile is newly created (has little data), reduce the impact
    const profileAge = getProfileAge(profile);
    const ageMultiplier = Math.min(profileAge / 7, 1); // threshold 7 hari

    // Base score: deduction multiplied by age multiplier
    const rawScore = 100 - totalDeduction * ageMultiplier;
    // Clamp to range 0-100
    return Math.max(0, Math.min(100, Math.round(rawScore)));
  } catch (error) {
    return 0;
  }
}

/**
 * Calculates the profile age in days.
 */
function getProfileAge(profile: ProjectPatternProfile): number {
  try {
    const created = new Date(profile.createdAt).getTime();
    if (Number.isNaN(created)) return 0;
    const now = Date.now();
    return Math.floor((now - created) / 86_400_000);
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return 0;
  }
}

// ─── Formatting ────────────────────────────────────────────────────────────

/**
 * Formats a list of violations into a human-readable Markdown report.
 *
 * Generates a structured report with a summary, breakdown by category,
 * and a full list of violations with severity and fix suggestions.
 *
 * @param violations - List of violations to format
 * @returns string — Markdown formatted report
 *
 * @example
 * ```ts
 * console.log(formatViolationReport(violations));
 * // Output:
 * // # Consistency Violations Report
 * // ...
 * ```
 */
export function formatViolationReport(violations: ConsistencyViolation[]): string {
  const lines: string[] = [];

  try {
    lines.push("# Consistency Violations Report");
    lines.push("");
    lines.push(`**Total Violations:** ${violations.length}`);
    lines.push("");

    if (violations.length === 0) {
      lines.push("No violations found. Code is already consistent!");
      lines.push("");
      return lines.join("\n");
    }

    // Kelompokkan berdasarkan severity
    const bySeverity: Record<string, number> = {};
    for (const v of violations) {
      bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    }

    lines.push("## Summary");
    lines.push("| Severity | Count |");
    lines.push("|----------|--------|");
    for (const [severity, count] of Object.entries(bySeverity)) {
      const label = severity === "error" ? "Error" : severity === "warning" ? "Warning" : "Info";
      lines.push(`| ${label} | ${count} |`);
    }
    lines.push("");

    // Kelompokkan berdasarkan kategori
    const byCategory: Record<string, ConsistencyViolation[]> = {};
    for (const v of violations) {
      const cat = v.category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(v);
    }

    lines.push("## Breakdown by Category");
    for (const [category, catViolations] of Object.entries(byCategory)) {
      const catLabel = category.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      lines.push("");
      lines.push(`### ${catLabel} (${catViolations.length})`);
      lines.push("");
      lines.push("| Line | Severity | Message |");
      lines.push("|------|----------|---------|");

      // Sort by line number
      catViolations.sort((a, b) => a.line - b.line);

      for (const v of catViolations) {
        const severityIcon =
          v.severity === "error" ? "Error" : v.severity === "warning" ? "Warning" : "Info";
        lines.push(`| ${v.line} | ${severityIcon} | ${escapeMd(v.message)} |`);
      }
    }

    lines.push("");

    // Detailed list of all violations
    lines.push("## Violation Details");
    lines.push("");
    for (let i = 0; i < violations.length; i++) {
      const v = violations[i];
      lines.push(`### ${i + 1}. ${v.category} — ${v.file}:${v.line}`);
      lines.push("");
      lines.push(`- **Category:** ${v.category}`);
      lines.push(`- **Severity:** ${v.severity}`);
      lines.push(`- **File:** ${v.file}`);
      lines.push(`- **Line:** ${v.line}`);
      lines.push(`- **Message:** ${v.message}`);
      lines.push(`- **Found:** ${v.actual}`);
      lines.push(`- **Expected:** ${v.expected}`);

      // Add fix suggestion
      const fix = suggestFix(v);
      lines.push(`- **Suggestion:** ${fix.suggestedFix}`);
      lines.push("");
    }

    lines.push("---");
    lines.push(`*Report generated at ${new Date().toISOString()}*`);
    lines.push("");
  } catch (error) {
    lines.push("An error occurred while formatting the report.");
  }

  return lines.join("\n");
}

/**
 * Escapes special Markdown characters for tables.
 */
function escapeMd(text: string): string {
  return escapeMarkdown(text);
}

/**
 * Formats a project profile into a human-readable Markdown string.
 *
 * @param profile - ProjectPatternProfile to format
 * @returns string — Markdown representation of the profile
 */
export function formatProfile(profile: ProjectPatternProfile): string {
  const lines: string[] = [];

  try {
    lines.push("# Project Pattern Profile");
    lines.push("");
    lines.push(`- **Created:** ${profile.createdAt}`);
    lines.push(`- **Updated:** ${profile.updatedAt}`);
    lines.push("");

    lines.push("## Naming Conventions");
    lines.push("");
    lines.push("| Language | Style |");
    lines.push("|--------|-------|");
    for (const [lang, style] of Object.entries(profile.namingConventions)) {
      lines.push(`| ${lang} | ${style} |`);
    }
    lines.push("");

    lines.push("## Code Style");
    lines.push("");
    lines.push(`- **Import Style:** ${profile.importStyle}`);
    lines.push(`- **Error Handling:** ${profile.errorHandling}`);
    lines.push(`- **File Organization:** ${profile.fileOrganization}`);
    lines.push(`- **Component Structure:** ${profile.componentStructure}`);
    lines.push(`- **Test Pattern:** ${profile.testPattern}`);
    lines.push("");

    lines.push("## Library Preferences");
    lines.push("");
    if (profile.preferredLibs.length > 0) {
      for (const lib of profile.preferredLibs) {
        lines.push(`- \`${lib}\``);
      }
    } else {
      lines.push("No library preferences detected yet.");
    }
    lines.push("");
  } catch (error) {
    lines.push("An error occurred while formatting the profile.");
  }

  return lines.join("\n");
}

/**
 * Formats a learned pattern into a human-readable string.
 *
 * @param learned - LearnedPattern to format
 * @returns string — Markdown representation of the learned pattern
 */
export function formatLearnedPattern(learned: LearnedPattern): string {
  const lines: string[] = [];

  try {
    lines.push("# Learned Pattern");
    lines.push("");
    lines.push(`- **Pattern:** ${learned.pattern}`);
    lines.push(`- **Category:** ${learned.category}`);
    lines.push(`- **Confidence:** ${(learned.confidence * 100).toFixed(0)}%`);
    lines.push(`- **Time:** ${learned.learnedAt}`);
    lines.push("");

    if (learned.example) {
      lines.push("## Contoh");
      lines.push("");
      lines.push("```");
      lines.push(learned.example);
      lines.push("```");
      lines.push("");
    }
  } catch (error) {
    lines.push("Terjadi error saat memformat pola pembelajaran.");
  }

  return lines.join("\n");
}

// ─── Aggregated Report ─────────────────────────────────────────────────────

/**
 * Generates a complete consistency report for one or more files.
 *
 * Combines validation results, scoring, and fix suggestions
 * into a single JSON-serializable report object.
 *
 * @param filePaths - Array of file paths to validate
 * @param profile - ProjectPatternProfile used as reference
 * @returns ConsistencyReport — complete report with score, violations, and suggestions
 */
export function generateConsistencyReport(
  filePaths: string[],
  profile: ProjectPatternProfile,
): ConsistencyReport {
  const now = new Date().toISOString();

  try {
    const violations = validateFilesAgainstProfile(filePaths, profile);
    const score = getConsistencyScore(profile, violations);
    const suggestions: FixSuggestion[] = violations.map((v) => suggestFix(v));

    // Statistik per kategori
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const v of violations) {
      byCategory[v.category] = (byCategory[v.category] ?? 0) + 1;
      bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    }

    return {
      score,
      totalViolations: violations.length,
      byCategory,
      bySeverity,
      violations,
      suggestions,
      generatedAt: now,
    };
  } catch (error) {
    return {
      score: 0,
      totalViolations: 0,
      byCategory: {},
      bySeverity: {},
      violations: [],
      suggestions: [],
      generatedAt: now,
    };
  }
}

/**
 * Formats a ConsistencyReport into a human-readable Markdown string.
 *
 * @param report - ConsistencyReport to format
 * @returns string — Markdown formatted report
 */
export function formatConsistencyReport(report: ConsistencyReport): string {
  const lines: string[] = [];

  try {
    lines.push("# Code Consistency Report");
    lines.push("");
    lines.push(`**Consistency Score:** ${report.score}/100`);
    lines.push(`**Total Violations:** ${report.totalViolations}`);
    lines.push(`**Generated:** ${report.generatedAt}`);
    lines.push("");

    // Visual rating
    lines.push("## Rating");
    lines.push("");
    if (report.score >= 90) {
      lines.push("Code is very consistent. Keep it up!");
    } else if (report.score >= 70) {
      lines.push("Code is fairly consistent. Some areas need improvement.");
    } else if (report.score >= 50) {
      lines.push("Code needs significant consistency improvement.");
    } else {
      lines.push("Code is highly inconsistent. Needs a thorough audit.");
    }
    lines.push("");

    if (report.bySeverity && Object.keys(report.bySeverity).length > 0) {
      lines.push("## Severity Breakdown");
      lines.push("| Severity | Count |");
      lines.push("|----------|-------|");
      for (const [sev, count] of Object.entries(report.bySeverity)) {
        lines.push(`| ${sev} | ${count} |`);
      }
      lines.push("");
    }

    if (report.byCategory && Object.keys(report.byCategory).length > 0) {
      lines.push("## Category Breakdown");
      lines.push("| Category | Count |");
      lines.push("|----------|-------|");
      for (const [cat, count] of Object.entries(report.byCategory)) {
        const catLabel = cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`| ${catLabel} | ${count} |`);
      }
      lines.push("");
    }

    if (report.violations && report.violations.length > 0) {
      lines.push("## Violation Details");
      lines.push("");
      for (let i = 0; i < report.violations.length; i++) {
        const v = report.violations[i];
        lines.push(`### ${i + 1}. ${v.file}:${v.line}`);
        lines.push("");
        lines.push(`- **Category:** ${v.category}`);
        lines.push(`- **Severity:** ${v.severity}`);
        lines.push(`- **Message:** ${v.message}`);
        lines.push(`- **Found:** \`${v.actual}\``);
        lines.push(`- **Expected:** \`${v.expected}\``);
        lines.push("");
      }
    }

    if (report.suggestions && report.suggestions.length > 0) {
      lines.push("## Fix Suggestions");
      lines.push("");
      for (let i = 0; i < report.suggestions.length; i++) {
        const s = report.suggestions[i];
        lines.push(`### ${i + 1}. ${s.file}:${s.line}`);
        lines.push("");
        lines.push(`**Suggestion:** ${s.suggestedFix}`);
        lines.push("");
        lines.push(`**Rationale:** ${s.rationale}`);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push(`*Report generated on ${report.generatedAt}*`);
    lines.push("");
  } catch (error) {
    lines.push("Error formatting consistency report.");
  }

  return lines.join("\n");
}

// ─── Log Management ─────────────────────────────────────────────────────────

/**
 * Reads violation history from the log.
 *
 * @param options - Filter options (limit, category, severity)
 * @returns ConsistencyViolation[] — list of violations from the log
 */
export function getViolationLog(options?: {
  limit?: number;
  category?: string;
  severity?: string;
}): ConsistencyViolation[] {
  try {
    let violations = readViolationLog();

    // Filter berdasarkan kategori
    if (options?.category) {
      violations = violations.filter((v) => v.category === options.category);
    }

    // Filter berdasarkan severity
    if (options?.severity) {
      violations = violations.filter((v) => v.severity === options.severity);
    }

    // Urutkan berdasarkan timestamp descending
    violations.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());

    // Batasi jumlah
    if (options?.limit && options.limit > 0) {
      violations = violations.slice(0, options.limit);
    }

    return violations;
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return [];
  }
}

/**
 * Clears the violation log.
 *
 * @returns boolean — true if successfully cleared
 */
export function clearViolationLog(): boolean {
  try {
    const dir = ensureStorageDir();
    const logPath = join(dir, VIOLATIONS_LOG);
    if (!existsSync(logPath)) return false;
    writeFileSync(logPath, "", "utf-8");
    return true;
  } catch (error: any) {
    console.warn(`[Consistency Enforcer] Warning: ${error.message}`);
    return false;
  }
}

// ─── Bulk Operations ───────────────────────────────────────────────────────

/**
 * Scans and validates an entire project directory against the profile.
 *
 * Walks the directory, finds all source files,
 * validates each one, and returns a complete report.
 *
 * @param root - Absolute path of the project directory
 * @param profile - ProjectPatternProfile (optional, auto-detected if not provided)
 * @returns ConsistencyReport — complete report
 */
export function scanAndValidate(root: string, profile?: ProjectPatternProfile): ConsistencyReport {
  try {
    // If profile is not provided, auto-detect
    const activeProfile = profile ?? detectProjectPatterns(root);
    const files = collectSourceFiles(resolve(root));

    // Limit for performance (max 200 files per scan)
    const maxFiles = 200;
    const fileBatch = files.length > maxFiles ? files.slice(0, maxFiles) : files;

    return generateConsistencyReport(fileBatch, activeProfile);
  } catch (error) {
    return {
      score: 0,
      totalViolations: 0,
      byCategory: {},
      bySeverity: {},
      violations: [],
      suggestions: [],
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Gets a profile summary and stats in one call.
 *
 * @param root - Absolute path of the project directory
 * @returns object containing profile and statistics
 */
export function getConsistencySummary(root: string): {
  profile: ProjectPatternProfile | null;
  stats: {
    totalFiles: number;
    lastScan: string | null;
    violationsCount: number;
  };
} {
  try {
    const profile = loadProfile();
    const violations = readViolationLog();
    const files = collectSourceFiles(resolve(root));

    // Check when the profile was last scanned
    const lastScan = profile?.updatedAt ?? null;

    return {
      profile,
      stats: {
        totalFiles: files.length,
        lastScan,
        violationsCount: violations.length,
      },
    };
  } catch (error) {
    return {
      profile: null,
      stats: {
        totalFiles: 0,
        lastScan: null,
        violationsCount: 0,
      },
    };
  }
}

// ─── Public API Aliases (requested function names) ───────────────────────────

/**
 * Scan project root and extract dominant patterns (naming, import style, error
 * handling, file organization, component structure, test pattern, preferred libs).
 *
 * This is an alias for `detectProjectPatterns`.
 *
 * @param root - Absolute path to the project root
 * @returns ProjectPatternProfile
 */
export function detectPatterns(root: string): ProjectPatternProfile {
  return detectProjectPatterns(root);
}

/**
 * Validate a single file against the project's pattern profile.
 *
 * This is an alias for `validateFileAgainstProfile`.
 *
 * @param filePath - Absolute path to the file
 * @param profile - The project pattern profile to validate against
 * @returns Array of ConsistencyViolation (empty if compliant)
 */
export function validateFile(
  filePath: string,
  profile: ProjectPatternProfile,
): ConsistencyViolation[] {
  return validateFileAgainstProfile(filePath, profile);
}

/**
 * Validate multiple files against the project's pattern profile.
 *
 * This is an alias for `validateFilesAgainstProfile`.
 *
 * @param filePaths - Array of absolute file paths
 * @param profile - The project pattern profile to validate against
 * @returns Array of ConsistencyViolation across all files
 */
export function validateFiles(
  filePaths: string[],
  profile: ProjectPatternProfile,
): ConsistencyViolation[] {
  return validateFilesAgainstProfile(filePaths, profile);
}

/**
 * Learn patterns from user's manual edits to improve pattern detection.
 *
 * This is an alias for `learnFromUserEdit`.
 *
 * @param originalContent - File content before editing
 * @param editedContent - File content after editing
 * @returns LearnedPattern with confidence score
 */
export function learnFromEdit(originalContent: string, editedContent: string): LearnedPattern {
  return learnFromUserEdit(originalContent, editedContent);
}

/**
 * Calculate a consistency score (0-100) based on the profile and violations.
 *
 * This is an alias for `getConsistencyScore`.
 *
 * @param profile - The project pattern profile
 * @param violations - Array of violations found
 * @returns Score from 0 (worst) to 100 (best)
 */
export function getScore(
  profile: ProjectPatternProfile,
  violations: ConsistencyViolation[],
): number {
  return getConsistencyScore(profile, violations);
}

/**
 * Format violations into a human-readable Markdown report.
 *
 * This is an alias for `formatViolationReport`.
 *
 * @param violations - Array of violations to format
 * @returns Markdown string report
 */
export function formatReport(violations: ConsistencyViolation[]): string {
  return formatViolationReport(violations);
}
