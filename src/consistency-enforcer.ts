#!/usr/bin/env node
/**
 * Consistency Enforcer — Penegak Konsistensi Kode
 *
 * Mendeteksi, memvalidasi, dan memperbaiki inkonsistensi pola kode
 * di seluruh basis kode dengan cara:
 * 1. Memindai kode yang ada untuk mengekstrak pola dominan (project pattern profile)
 * 2. Memvalidasi file terhadap profile untuk menemukan pelanggaran
 * 3. Belajar dari edit user untuk meningkatkan deteksi pola
 * 4. Memberikan saran perbaikan yang actionable
 *
 * Penyimpanan:
 * - .claude/consistency-enforcer/pattern-profile.json — profile pola proyek
 * - .claude/consistency-enforcer/violations.log — riwayat pelanggaran
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Profile pola proyek yang mendeskripsikan konvensi dominan.
 * Digunakan sebagai acuan validasi konsistensi.
 */
export interface ProjectPatternProfile {
  /** Konvensi penamaan per jenis file/entity, misal: { "component": "PascalCase", "function": "camelCase", "file": "kebab-case" } */
  namingConventions: Record<string, string>;
  /** Gaya import yang dominan: "default", "named", "mixed" */
  importStyle: string;
  /** Pola error handling: "try-catch", "callback", "result-type", "mixed" */
  errorHandling: string;
  /** Organisasi file: "feature-based", "type-based", "flat", "mixed" */
  fileOrganization: string;
  /** Library/library yang lebih disukai dalam proyek */
  preferredLibs: string[];
  /** Struktur komponen: "function", "class", "arrow-function", "mixed" */
  componentStructure: string;
  /** Pola testing: "describe-it", "test", "assert", "vitest", "jest", "mixed" */
  testPattern: string;
  /** Timestamp pembuatan profile */
  createdAt: string;
  /** Timestamp update terakhir */
  updatedAt: string;
}

/**
 * Sebuah pelanggaran konsistensi yang ditemukan dalam file.
 */
export interface ConsistencyViolation {
  /** ID unik pelanggaran */
  id: string;
  /** Path file relatif terhadap root proyek */
  file: string;
  /** Nomor baris tempat pelanggaran (0 jika tidak spesifik) */
  line: number;
  /** Kategori pelanggaran */
  category: "naming" | "import-style" | "error-handling" | "file-org" | "lib-preference" | "component-structure" | "test-pattern";
  /** Deskripsi pelanggaran */
  message: string;
  /** Severity: "error" = harus diperbaiki, "warning" = sebaiknya diperbaiki, "info" = saran */
  severity: "error" | "warning" | "info";
  /** Nilai yang ditemukan */
  actual: string;
  /** Nilai yang diharapkan berdasarkan profile */
  expected: string;
  /** Timestamp deteksi */
  detectedAt: string;
}

/**
 * Hasil pembelajaran dari edit user.
 */
export interface LearnedPattern {
  /** Pola yang dipelajari */
  pattern: string;
  /** Tingkat kepercayaan 0.0 - 1.0 */
  confidence: number;
  /** Kategori pola */
  category: string;
  /** Contoh dari kode user */
  example: string;
  /** Timestamp pembelajaran */
  learnedAt: string;
}

/**
 * Saran perbaikan untuk sebuah pelanggaran.
 */
export interface FixSuggestion {
  /** Path file yang perlu diperbaiki */
  file: string;
  /** Nomor baris */
  line: number;
  /** Saran kode pengganti (jika tersedia) */
  suggestedFix: string;
  /** Penjelasan mengapa perubahan ini diperlukan */
  rationale: string;
}

/**
 * Laporan konsistensi untuk satu atau banyak file.
 */
export interface ConsistencyReport {
  /** Skor konsistensi keseluruhan 0-100 */
  score: number;
  /** Total pelanggaran ditemukan */
  totalViolations: number;
  /** Rincian per kategori */
  byCategory: Record<string, number>;
  /** Rincian per severity */
  bySeverity: Record<string, number>;
  /** Daftar pelanggaran */
  violations: ConsistencyViolation[];
  /** Saran perbaikan (jika ada) */
  suggestions: FixSuggestion[];
  /** Timestamp laporan */
  generatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Direktori penyimpanan data consistency enforcer */
const STORAGE_DIR = ".claude/consistency-enforcer";
/** File profile pola proyek */
const PROFILE_FILE = "pattern-profile.json";
/** File log pelanggaran */
const VIOLATIONS_LOG = "violations.log";

/** Ekstensi file yang dikenali untuk pemindaian */
const RECOGNIZED_EXTENSIONS = new Set([
  ".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs",
  ".java", ".rb", ".php", ".swift", ".kt", ".scala",
]);

/** Mapping ekstensi ke bahasa */
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

/** Direktori yang selalu dilewati saat pemindaian */
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", "build", ".next", "vendor",
  ".gradle", "generated", "coverage", ".claude",
]);

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Memastikan direktori penyimpanan ada, membuat jika belum.
 */
function ensureStorageDir(): string {
  const dir = join(process.cwd(), STORAGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Membaca file JSON dengan error handling.
 */
function readJSON<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Menulis file JSON dengan formatting.
 */
function writeJSON(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Melakukan escaping karakter khusus RegExp.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/**
 * Menentukan gaya penamaan dari sebuah string.
 * Mengembalikan "PascalCase", "camelCase", "snake_case", "kebab-case", "UPPER_CASE", atau "unknown".
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
 * Membaca isi file teks, mengembalikan string kosong jika gagal.
 */
function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Menulis log pelanggaran ke file violations.log (append).
 */
function appendViolationLog(violation: ConsistencyViolation): void {
  try {
    const dir = ensureStorageDir();
    const logPath = join(dir, VIOLATIONS_LOG);
    appendFileSync(logPath, JSON.stringify(violation) + "\n", "utf-8");
  } catch {
    // gagal logging — non-critical
  }
}

/**
 * Mereset log pelanggaran (menimpa dengan konten baru).
 */
function resetViolationLog(violations: ConsistencyViolation[]): void {
  try {
    const dir = ensureStorageDir();
    const logPath = join(dir, VIOLATIONS_LOG);
    const lines = violations.map((v) => JSON.stringify(v)).join("\n");
    writeFileSync(logPath, lines + (lines ? "\n" : ""), "utf-8");
  } catch {
    // non-critical
  }
}

/**
 * Membaca log pelanggaran yang tersimpan.
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
      } catch {
        // skip korup
      }
    }
    return violations;
  } catch {
    return [];
  }
}

// ─── Project Pattern Detection ─────────────────────────────────────────────

/**
 * Memindai direktori proyek untuk mengekstrak pola dominan dari kode yang ada.
 *
 * Fungsi ini melakukan walk pada struktur direktori, membaca file-file sumber,
 * dan menganalisis konvensi penamaan, gaya import, pola error handling,
 * organisasi file, library yang digunakan, struktur komponen, dan pola testing.
 *
 * @param root - Path absolut atau relatif ke root proyek
 * @returns ProjectPatternProfile — objek profile pola proyek
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
    // Kumpulkan file-file yang akan dianalisis
    const files = collectSourceFiles(resolvedRoot);
    if (files.length === 0) {
      return defaultProfile;
    }

    // Statistik untuk setiap kategori
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

    // Deteksi organisasi file: lihat struktur direktori
    const dirEntries = collectDirectoryStructure(resolvedRoot);
    totalDirs = dirEntries.total;
    featureDirs = dirEntries.featureDirs;
    typeDirs = dirEntries.typeDirs;

    // Analisis setiap file
    for (const file of files) {
      const content = readFileSafe(file);
      if (!content) continue;

      const ext = extname(file);
      const lang = EXT_TO_LANG[ext] ?? "Unknown";

      // Inisialisasi counter penamaan untuk bahasa ini
      if (!namingCounts[lang]) {
        namingCounts[lang] = { PascalCase: 0, camelCase: 0, snake_case: 0, "kebab-case": 0, UPPER_CASE: 0, unknown: 0 };
      }

      // Deteksi konvensi penamaan dari identifier (fungsi, kelas, variabel, konstanta)
      detectNamingFromContent(content, namingCounts[lang]);

      // Deteksi gaya import
      const importStats = detectImportStyle(content);
      importDefaultCount += importStats.defaultImports;
      importNamedCount += importStats.namedImports;

      // Deteksi pola error handling
      const errorStats = detectErrorHandlingPattern(content);
      tryCatchCount += errorStats.tryCatch;
      callbackCount += errorStats.callback;
      resultTypeCount += errorStats.resultType;

      // Deteksi library yang digunakan
      const libs = detectUsedLibraries(content);
      for (const lib of libs) {
        libUsage[lib] = (libUsage[lib] ?? 0) + 1;
      }

      // Deteksi struktur komponen (React components, classes, functions)
      const compStats = detectComponentStructure(content, ext);
      functionCompCount += compStats.functionDeclaration;
      classCompCount += compStats.classDeclaration;
      arrowFnCompCount += compStats.arrowFunction;

      // Deteksi pola testing
      const testStats = detectTestPattern(content);
      describeItCount += testStats.describeIt;
      testGlobalCount += testStats.testGlobal;
      assertCount += testStats.assert;
    }

    // Hitung dominasi naming convention per bahasa
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

    // Tentukan gaya import dominan
    const totalImports = importDefaultCount + importNamedCount;
    let importStyle = "mixed";
    if (totalImports > 0) {
      const defaultRatio = importDefaultCount / totalImports;
      if (defaultRatio > 0.7) importStyle = "default";
      else if (defaultRatio < 0.3) importStyle = "named";
      else importStyle = "mixed";
    }

    // Tentukan pola error handling dominan
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

    // Tentukan organisasi file
    let fileOrganization = "mixed";
    if (totalDirs > 0) {
      const featureRatio = featureDirs / totalDirs;
      const typeRatio = typeDirs / totalDirs;
      if (featureRatio > 0.5) fileOrganization = "feature-based";
      else if (typeRatio > 0.5) fileOrganization = "type-based";
      else if (totalDirs < 3) fileOrganization = "flat";
    }

    // Tentukan library yang paling disukai (top 5)
    const preferredLibs = Object.entries(libUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lib]) => lib);

    // Tentukan struktur komponen dominan
    const totalCompPatterns = functionCompCount + classCompCount + arrowFnCompCount;
    let componentStructure = "mixed";
    if (totalCompPatterns > 0) {
      const fnRatio = functionCompCount / totalCompPatterns;
      const classRatio = classCompCount / totalCompPatterns;
      if (fnRatio > 0.6) componentStructure = "function";
      else if (classRatio > 0.6) componentStructure = "class";
      else if (arrowFnCompCount / totalCompPatterns > 0.6) componentStructure = "arrow-function";
    }

    // Tentukan pola testing dominan
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

    // Simpan profile ke storage
    saveProfile(profile);

    return profile;
  } catch (error) {
    // Jika terjadi error, kembalikan default profile
    return defaultProfile;
  }
}

/**
 * Mengumpulkan semua file sumber yang relevan dari direktori.
 */
function collectSourceFiles(root: string): string[] {
  const result: string[] = [];

  function walk(dir: string) {
    let dirEntries: string[];
    try {
      dirEntries = readdirSafe(dir);
    } catch {
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
      } catch {
        continue;
      }
    }
  }

  walk(root);
  return result;
}

/**
 * Membaca isi direktori dengan aman.
 */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Mendapatkan status file dengan aman.
 */
function statSafe(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Menganalisis struktur direktori untuk menentukan organisasi file.
 */
function collectDirectoryStructure(root: string): { total: number; featureDirs: number; typeDirs: number } {
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

    // Feature directory biasanya berisi file-file dengan nama domain (users, orders, auth)
    if (/^(users|orders|auth|payments|products|carts|admin|api|modules|features|domains)/i.test(entry)) {
      featureDirs++;
    }

    // Type-based directory biasanya berisi nama generik (components, services, utils, hooks)
    if (/^(components|services|utils|hooks|helpers|middlewares|controllers|models|views|templates)/i.test(entry)) {
      typeDirs++;
    }
  }

  return { total, featureDirs, typeDirs };
}

/**
 * Mendeteksi konvensi penamaan dari konten file.
 */
function detectNamingFromContent(content: string, counts: Record<string, number>): void {
  // Deteksi kelas (PascalCase)
  const classMatches = content.match(/\bclass\s+([A-Z][a-zA-Z0-9]+)\b/g);
  if (classMatches) counts.PascalCase += classMatches.length;

  // Deteksi fungsi (camelCase atau PascalCase untuk React components)
  const fnMatches = content.match(/\bfunction\s+([a-zA-Z_$][\w$]+)\b/g);
  if (fnMatches) {
    for (const match of fnMatches) {
      const name = match.replace(/^function\s+/, "");
      const style = detectNamingStyle(name);
      if (counts[style] !== undefined) counts[style]++;
    }
  }

  // Deteksi variabel/konstanta dengan assignment
  const constMatches = content.match(/\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*[=:]/g);
  if (constMatches) {
    for (const match of constMatches) {
      const name = match.replace(/^(?:const|let|var)\s+/, "").replace(/\s*[=:]\s*$/, "").trim();
      const style = detectNamingStyle(name);
      if (counts[style] !== undefined) counts[style]++;
    }
  }

  // Deteksi exports (named exports)
  const exportMatches = content.match(/\bexport\s+(?:const|let|var|function|class|interface|type)\s+([a-zA-Z_$][\w$]*)/g);
  if (exportMatches) {
    for (const match of exportMatches) {
      const name = match.replace(/^export\s+(?:const|let|var|function|class|interface|type)\s+/, "");
      const style = detectNamingStyle(name);
      if (counts[style] !== undefined) counts[style]++;
    }
  }
}

/**
 * Mendeteksi gaya import (named vs default) dari konten.
 */
function detectImportStyle(content: string): { defaultImports: number; namedImports: number } {
  let defaultImports = 0;
  let namedImports = 0;

  // Import default: import X from 'y'
  const defaultMatches = content.match(/^import\s+[A-Za-z_$][\w$]*\s+from\s+/gm);
  if (defaultMatches) defaultImports += defaultMatches.length;

  // Import named: import { X } from 'y'
  const namedMatches = content.match(/^import\s+\{[^}]*\}\s+from\s+/gm);
  if (namedMatches) namedImports += namedMatches.length;

  // Import named multi-line: import { \n X \n } from 'y'
  const namedMulti = content.match(/^import\s+\{[\s\S]*?\}\s+from\s+/gm);
  if (namedMulti) namedImports += namedMulti.length - (namedMatches?.length ?? 0);

  // Juga deteksi import * as
  const namespaceMatches = content.match(/^import\s+\*\s+as\s+/gm);
  if (namespaceMatches) defaultImports += namespaceMatches.length;

  return { defaultImports, namedImports };
}

/**
 * Mendeteksi pola error handling dari konten.
 */
function detectErrorHandlingPattern(content: string): { tryCatch: number; callback: number; resultType: number } {
  const tryCatch = (content.match(/\btry\s*\{/g) ?? []).length;
  const callback = (content.match(/\(err(?:or)?\s*(?:,|\))/g) ?? []).length +
                   (content.match(/\b(err|error)\s*=>/g) ?? []).length;
  const resultType = (content.match(/\bResult\b/g) ?? []).length +
                     (content.match(/\bOk\b|\bErr\b/g) ?? []).length +
                     (content.match(/\bEither\b/g) ?? []).length;

  return { tryCatch, callback, resultType };
}

/**
 * Mendeteksi library yang digunakan dari konten import/require.
 */
function detectUsedLibraries(content: string): string[] {
  const libs: string[] = [];

  // Cari import from 'library-name'
  const importMatches = content.matchAll(/from\s+['"]([^'"/]+)['"]/g);
  for (const match of importMatches) {
    if (match[1] && !match[1].startsWith(".") && !match[1].startsWith("/")) {
      libs.push(match[1]);
    }
  }

  // Cari require('library-name')
  const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"/]+)['"]/g);
  for (const match of requireMatches) {
    if (match[1] && !match[1].startsWith(".") && !match[1].startsWith("/")) {
      libs.push(match[1]);
    }
  }

  return libs;
}

/**
 * Mendeteksi struktur komponen dari konten berdasarkan ekstensi file.
 */
function detectComponentStructure(
  content: string,
  ext: string,
): { functionDeclaration: number; classDeclaration: number; arrowFunction: number } {
  const functionDeclaration = (content.match(/\bfunction\s+[A-Z][a-zA-Z0-9]*\s*\(/g) ?? []).length;
  const classDeclaration = (content.match(/\bclass\s+[A-Z][a-zA-Z0-9]*/g) ?? []).length;

  // Arrow function yang berbentuk `const X = (...) =>` (potensi komponen)
  const arrowFunction = ext === ".tsx" || ext === ".jsx"
    ? (content.match(/\bconst\s+[A-Z][a-zA-Z0-9]*\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g) ?? []).length
    : 0;

  return { functionDeclaration, classDeclaration, arrowFunction };
}

/**
 * Mendeteksi pola testing dari konten file.
 */
function detectTestPattern(content: string): { describeIt: number; testGlobal: number; assert: number } {
  const describeIt = (content.match(/\bdescribe\s*\(/g) ?? []).length +
                     (content.match(/\bit\s*\(/g) ?? []).length;
  const testGlobal = (content.match(/\btest\s*\(/g) ?? []).length;
  const assert = (content.match(/\bassert\s*\./g) ?? []).length +
                 (content.match(/\bexpect\s*\(/g) ?? []).length +
                 (content.match(/\bassert\s*\(/g) ?? []).length;

  return { describeIt, testGlobal, assert };
}

// ─── Profile Persistence ────────────────────────────────────────────────────

/**
 * Menyimpan profile ke file storage.
 */
function saveProfile(profile: ProjectPatternProfile): void {
  try {
    const dir = ensureStorageDir();
    writeJSON(join(dir, PROFILE_FILE), profile);
  } catch {
    // non-critical
  }
}

/**
 * Membaca profile dari file storage.
 *
 * @returns ProjectPatternProfile atau null jika belum ada
 */
export function loadProfile(): ProjectPatternProfile | null {
  try {
    const dir = ensureStorageDir();
    const filePath = join(dir, PROFILE_FILE);
    return readJSON<ProjectPatternProfile | null>(filePath, null);
  } catch {
    return null;
  }
}

/**
 * Menghapus profile dari storage.
 *
 * @returns true jika berhasil dihapus, false jika tidak ada
 */
export function clearProfile(): boolean {
  try {
    const dir = ensureStorageDir();
    const filePath = join(dir, PROFILE_FILE);
    if (!existsSync(filePath)) return false;
    writeFileSync(filePath, JSON.stringify(null), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ─── File Validation ────────────────────────────────────────────────────────

/**
 * Memvalidasi sebuah file terhadap profile konsistensi proyek.
 *
 * Membaca file, menganalisis kontennya, dan membandingkan dengan
 * pola-pola yang terdefinisi di profile. Mengembalikan daftar
 * pelanggaran yang ditemukan.
 *
 * @param filePath - Path absolut file yang akan divalidasi
 * @param profile - ProjectPatternProfile yang digunakan sebagai acuan
 * @returns ConsistencyViolation[] — daftar pelanggaran (kosong jika patuh)
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

    // 1. Validasi konvensi penamaan untuk bahasa yang dikenali
    if (profile.namingConventions[lang]) {
      const expectedStyle = profile.namingConventions[lang];
      const namingViolations = validateNamingConvention(content, expectedStyle, filePath);
      violations.push(...namingViolations);
    }

    // 2. Validasi gaya import
    if (profile.importStyle !== "mixed") {
      const importViolations = validateImportStyle(content, profile.importStyle, filePath);
      violations.push(...importViolations);
    }

    // 3. Validasi pola error handling
    if (profile.errorHandling !== "mixed") {
      const errorViolations = validateErrorHandling(content, profile.errorHandling, filePath);
      violations.push(...errorViolations);
    }

    // 4. Validasi library preference
    if (profile.preferredLibs.length > 0) {
      const libViolations = validateLibPreference(content, profile.preferredLibs, filePath);
      violations.push(...libViolations);
    }

    // 5. Validasi struktur komponen untuk file tsx/jsx
    if ((ext === ".tsx" || ext === ".jsx") && profile.componentStructure !== "mixed") {
      const compViolations = validateComponentStructure(content, profile.componentStructure, filePath);
      violations.push(...compViolations);
    }

    // 6. Validasi pola testing untuk file test
    if (isTestFile(filePath) && profile.testPattern !== "mixed") {
      const testViolations = validateTestPattern(content, profile.testPattern, filePath);
      violations.push(...testViolations);
    }

    // Beri ID unik dan timestamp ke setiap pelanggaran
    const enrichedViolations = violations.map((v) => ({
      ...v,
      id: `violation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      detectedAt: now,
    }));

    // Log pelanggaran untuk riwayat
    for (const v of enrichedViolations) {
      appendViolationLog(v);
    }

    return enrichedViolations;
  } catch (error) {
    // Jika validasi gagal total, kembalikan array kosong
    return [];
  }
}

/**
 * Memvalidasi banyak file terhadap profile konsistensi proyek.
 *
 * Memanggil validateFileAgainstProfile untuk setiap file dan
 * mengumpulkan semua pelanggaran dalam satu array.
 *
 * @param filePaths - Array path absolut file yang akan divalidasi
 * @param profile - ProjectPatternProfile yang digunakan sebagai acuan
 * @returns ConsistencyViolation[] — gabungan pelanggaran dari semua file
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
    } catch {
      // Skip file yang gagal divalidasi
      continue;
    }
  }

  return allViolations;
}

/**
 * Memeriksa apakah sebuah file adalah file test berdasarkan nama/路径.
 */
function isTestFile(filePath: string): boolean {
  const base = basename(filePath);
  return /\.(test|spec|e2e|integration)\.(ts|js|tsx|jsx)$/.test(base) ||
         /\.(test|spec)\.(py|go|rs)$/.test(base) ||
         base.startsWith("test_") ||
         base.endsWith("_test.go") ||
         base.endsWith("_test.rs");
}

/**
 * Memvalidasi konvensi penamaan dalam konten file.
 */
function validateNamingConvention(
  content: string,
  expectedStyle: string,
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  // Periksa kelas
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
        message: `Nama kelas "${name}" seharusnya menggunakan ${expectedStyle}`,
        severity: "error",
        actual: name,
        expected: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
        detectedAt: "",
      });
    }
  }

  // Periksa fungsi/konstanta untuk camelCase (jika profile menuntut)
  if (expectedStyle === "camelCase") {
    const constRegex = /\bconst\s+([A-Z][a-zA-Z0-9]+)\s*[=:]/g;
    while ((match = constRegex.exec(content)) !== null) {
      const name = match[1];
      // Lewati konstanta UPPER_CASE
      if (/^[A-Z0-9_]+$/.test(name)) continue;
      violations.push({
        id: "",
        file: filePath,
        line: countLinesUpTo(content, match.index),
        category: "naming",
        message: `Nama konstanta "${name}" sebaiknya camelCase, bukan PascalCase`,
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
 * Memvalidasi gaya import.
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
      message: `Proyek ini dominan menggunakan named imports, tetapi ditemukan ${defaultImports} default import`,
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
      message: `Proyek ini dominan menggunakan default imports, tetapi ditemukan ${namedImports} named imports`,
      severity: "warning",
      actual: `${namedImports} named imports`,
      expected: "default imports",
      detectedAt: "",
    });
  }

  return violations;
}

/**
 * Memvalidasi pola error handling.
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
      message: "Proyek ini dominan menggunakan try/catch, tetapi ditemukan pola callback",
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
      message: "Proyek ini dominan menggunakan Result type, tetapi ditemukan try/catch",
      severity: "info",
      actual: `${patterns.tryCatch} try/catch blocks`,
      expected: "Result type",
      detectedAt: "",
    });
  }

  return violations;
}

/**
 * Memvalidasi preferensi library.
 */
function validateLibPreference(
  content: string,
  preferredLibs: string[],
  filePath: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const usedLibs = detectUsedLibraries(content);

  // Daftar library populer yang mungkin jadi alternatif
  const alternatives: Record<string, string[]> = {
    "lodash": ["lodash-es"],
    "moment": ["date-fns", "dayjs"],
    "axios": ["fetch", "ky"],
    "express": ["fastify", "hono"],
    "redux": ["zustand", "jotai"],
    "styled-components": ["tailwindcss", "css-modules"],
    "enzyme": ["@testing-library/react"],
    "mocha": ["vitest", "jest"],
    "chai": ["vitest", "jest"],
    "sinon": ["vitest", "jest"],
    "request": ["node-fetch", "undici"],
    "bluebird": ["native-promise"],
  };

  for (const lib of usedLibs) {
    // Cek apakah library yang digunakan ada di preferensi
    if (!preferredLibs.includes(lib)) {
      // Cek apakah ada alternatif yang lebih disukai
      for (const [preferred, alts] of Object.entries(alternatives)) {
        if (alts.includes(lib) && preferredLibs.includes(preferred)) {
          violations.push({
            id: "",
            file: filePath,
            line: 1,
            category: "lib-preference",
            message: `Library "${lib}" memiliki alternatif yang lebih disukai: "${preferred}"`,
            severity: "info",
            actual: lib,
            expected: preferred,
            detectedAt: "",
          });
          break;
        }
      }

      // Jika library tidak dikenal sama sekali dan bukan internal, catat sebagai info
      if (!lib.startsWith(".") && !preferredLibs.includes(lib)) {
        violations.push({
          id: "",
          file: filePath,
          line: 1,
          category: "lib-preference",
          message: `Library "${lib}" tidak ada dalam preferensi proyek: [${preferredLibs.join(", ")}]`,
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
 * Memvalidasi struktur komponen untuk file React.
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
      message: `Proyek menggunakan function components, tetapi ditemukan ${stats.classDeclaration} class components`,
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
      message: "Proyek menggunakan arrow function components, tetapi ditemukan function declarations",
      severity: "info",
      actual: `${stats.functionDeclaration} function declarations`,
      expected: "arrow functions",
      detectedAt: "",
    });
  }

  return violations;
}

/**
 * Memvalidasi pola testing.
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
        message: `Proyek menggunakan describe/it, tetapi ditemukan ${stats.testGlobal} test() calls`,
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
 * Menghitung nomor baris dari index tertentu dalam string.
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
 * Mempelajari pola dari perubahan yang dilakukan user.
 *
 * Membandingkan konten asli dan konten setelah diedit untuk mengekstrak
 * pola yang mungkin menjadi preferensi user. Fungsi ini mendeteksi
 * perubahan dalam konvensi penamaan, gaya import, dan struktur kode.
 *
 * @param originalContent - Konten file sebelum diedit
 * @param editedContent - Konten file setelah diedit
 * @returns LearnedPattern — pola yang dipelajari beserta confidence score
 *
 * @example
 * ```ts
 * const result = learnFromUserEdit(originalCode, editedCode);
 * console.log(`Pola terdeteksi: ${result.pattern} (confidence: ${result.confidence})`);
 * ```
 */
export function learnFromUserEdit(
  originalContent: string,
  editedContent: string,
): LearnedPattern {
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

    // Jika sama persis, tidak ada yang dipelajari
    if (originalContent === editedContent) {
      return {
        pattern: "no-change",
        confidence: 0,
        category: "unknown",
        example: "",
        learnedAt: now,
      };
    }

    // Analisis perubahan naming convention
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

    // Analisis perubahan import style
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

    // Analisis perubahan error handling
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

    // Tidak ada pola yang terdeteksi secara spesifik
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
 * Menganalisis perubahan konvensi penamaan antara original dan edited.
 */
function analyzeNamingChanges(
  original: string,
  edited: string,
): { style: string; confidence: number; example: string } | null {
  // Cari identifier baru yang muncul di edited tapi tidak di original
  const originalIdentifiers = extractIdentifiers(original);
  const editedIdentifiers = extractIdentifiers(edited);

  const newIdentifiers = editedIdentifiers.filter(
    (id) => !originalIdentifiers.includes(id),
  );

  if (newIdentifiers.length === 0) return null;

  // Hitung distribusi gaya penamaan identifier baru
  const styleCounts: Record<string, number> = {};
  for (const id of newIdentifiers) {
    const style = detectNamingStyle(id);
    styleCounts[style] = (styleCounts[style] ?? 0) + 1;
  }

  // Cari style dominan
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
 * Menganalisis perubahan gaya import.
 */
function analyzeImportStyleChange(
  original: string,
  edited: string,
): { style: string; confidence: number; example: string } | null {
  // Cari import baru di edited
  const originalImports = extractImports(original);
  const editedImports = extractImports(edited);

  const newImports = editedImports.filter(
    (imp) => !originalImports.includes(imp),
  );

  if (newImports.length === 0) return null;

  // Hitung gaya import baru
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
 * Menganalisis perubahan pola error handling.
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
 * Mengekstrak identifier (nama fungsi, kelas, variabel) dari konten.
 */
function extractIdentifiers(content: string): string[] {
  const identifiers = new Set<string>();

  // Kelas
  const classMatches = content.matchAll(/\bclass\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of classMatches) identifiers.add(m[1]);

  // Fungsi
  const fnMatches = content.matchAll(/\bfunction\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of fnMatches) identifiers.add(m[1]);

  // Interface / Type
  const typeMatches = content.matchAll(/\b(?:interface|type)\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of typeMatches) identifiers.add(m[1]);

  // Konstanta/variabel level modul dengan export
  const constMatches = content.matchAll(/\b(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)/g);
  for (const m of constMatches) identifiers.add(m[1]);

  return [...identifiers];
}

/**
 * Mengekstrak pernyataan import dari konten.
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
 * Mengekstrak potongan kode yang berubah antara dua versi.
 */
function extractChangedSnippet(original: string, edited: string): string {
  const origLines = original.split("\n");
  const editLines = edited.split("\n");

  // Cari baris pertama yang berbeda
  for (let i = 0; i < Math.min(origLines.length, editLines.length); i++) {
    if (origLines[i] !== editLines[i]) {
      const start = Math.max(0, i - 1);
      const end = Math.min(editLines.length, i + 4);
      return editLines.slice(start, end).join("\n");
    }
  }

  // Jika panjang berbeda, ambil dari bagian yang baru
  if (editLines.length > origLines.length) {
    return editLines.slice(origLines.length).join("\n").slice(0, 200);
  }

  return "";
}

// ─── Fix Suggestions ───────────────────────────────────────────────────────

/**
 * Membuat saran perbaikan untuk sebuah pelanggaran konsistensi.
 *
 * Berdasarkan kategori dan tipe pelanggaran, fungsi ini menghasilkan
 * saran perbaikan yang spesifik dan actionable.
 *
 * @param violation - Pelanggaran yang ingin diperbaiki
 * @returns FixSuggestion — saran perbaikan yang detail
 *
 * @example
 * ```ts
 * const suggestion = suggestFix(violation);
 * console.log(`Perbaiki baris ${suggestion.line}: ${suggestion.suggestedFix}`);
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
          suggestedFix: `Ganti "${violation.actual}" menjadi "${violation.expected}"`,
          rationale: `Mengikuti konvensi penamaan proyek yang menggunakan ${violation.expected}`,
        };
      }

      case "import-style": {
        const isDefaultExpected = violation.expected === "default imports";
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: isDefaultExpected
            ? "Ubah named imports menjadi default imports: `import X from 'module'`"
            : "Ubah default imports menjadi named imports: `import { X } from 'module'`",
          rationale: `Konsisten dengan gaya import yang dominan di proyek ini`,
        };
      }

      case "error-handling": {
        const isTryCatchExpected = violation.expected === "try/catch";
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: isTryCatchExpected
            ? "Bungkus kode dalam blok try/catch:\n\ttry {\n\t  // kode\n\t} catch (error) {\n\t  // handle error\n\t}"
            : "Gunakan Result type pattern:\n\tconst result = await operation();\n\tif (result.isErr()) { ... }",
          rationale: `Konsisten dengan pola error handling proyek ini (${violation.expected})`,
        };
      }

      case "lib-preference": {
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: `Ganti import "${violation.actual}" dengan "${violation.expected}"`,
          rationale: `Library "${violation.expected}" adalah preferensi yang sudah ditetapkan untuk proyek ini`,
        };
      }

      case "component-structure": {
        const useFunction = violation.expected === "function declarations";
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: useFunction
            ? "Ubah class component menjadi function component:\n\tfunction Component(props) { ... }"
            : "Ubah function declaration menjadi arrow function:\n\tconst Component = (props) => { ... }",
          rationale: `Konsisten dengan struktur komponen yang digunakan di proyek ini (${violation.expected})`,
        };
      }

      case "test-pattern": {
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: "Gunakan describe/it pattern:\n\tdescribe('feature', () => {\n\t  it('should ...', () => { ... });\n\t});",
          rationale: `Konsisten dengan pola testing yang digunakan di proyek ini (${violation.expected})`,
        };
      }

      default:
        return {
          file: filePath,
          line: violation.line,
          suggestedFix: "Tinjau dan sesuaikan dengan pola proyek yang sudah ditetapkan",
          rationale: `Pelanggaran kategori "${violation.category}" perlu disesuaikan`,
        };
    }
  } catch (error) {
    return {
      file: violation.file,
      line: violation.line,
      suggestedFix: "Tidak dapat membuat saran otomatis",
      rationale: "Terjadi error saat memproses saran perbaikan",
    };
  }
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * Menghitung skor konsistensi proyek berdasarkan profile dan pelanggaran.
 *
 * Skor 100 berarti完全没有 pelanggaran. Setiap pelanggaran
 * mengurangi skor berdasarkan severity-nya: error (-15), warning (-5), info (-1).
 *
 * @param profile - ProjectPatternProfile yang digunakan sebagai acuan
 * @param violations - Daftar pelanggaran yang ditemukan
 * @returns number — skor konsistensi 0-100
 *
 * @example
 * ```ts
 * const score = getConsistencyScore(profile, violations);
 * console.log(`Skor konsistensi: ${score}/100`);
 * ```
 */
export function getConsistencyScore(
  profile: ProjectPatternProfile,
  violations: ConsistencyViolation[],
): number {
  try {
    if (!profile || violations.length === 0) return 100;

    // Hitung total pengurangan berdasarkan severity
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

    // Jika profile baru dibuat (belum memiliki banyak data), kurangi dampaknya
    const profileAge = getProfileAge(profile);
    const ageMultiplier = Math.min(profileAge / 7, 1); // threshold 7 hari

    // Base score: pengurangan dikalikan dengan age multiplier
    const rawScore = 100 - totalDeduction * ageMultiplier;
    // Clamp ke range 0-100
    return Math.max(0, Math.min(100, Math.round(rawScore)));
  } catch (error) {
    return 0;
  }
}

/**
 * Menghitung umur profile dalam hari.
 */
function getProfileAge(profile: ProjectPatternProfile): number {
  try {
    const created = new Date(profile.createdAt).getTime();
    if (Number.isNaN(created)) return 0;
    const now = Date.now();
    return Math.floor((now - created) / 86_400_000);
  } catch {
    return 0;
  }
}

// ─── Formatting ────────────────────────────────────────────────────────────

/**
 * Memformat daftar pelanggaran menjadi laporan human-readable (Markdown).
 *
 * Menghasilkan laporan terstruktur dengan ringkasan, rincian per kategori,
 * dan daftar pelanggaran lengkap dengan severity dan saran perbaikan.
 *
 * @param violations - Daftar pelanggaran yang akan diformat
 * @returns string — laporan dalam format Markdown
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
    lines.push("# Laporan Pelanggaran Konsistensi");
    lines.push("");
    lines.push(`**Total Pelanggaran:** ${violations.length}`);
    lines.push("");

    if (violations.length === 0) {
      lines.push("Tidak ada pelanggaran yang ditemukan. Kode sudah konsisten!");
      lines.push("");
      return lines.join("\n");
    }

    // Kelompokkan berdasarkan severity
    const bySeverity: Record<string, number> = {};
    for (const v of violations) {
      bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    }

    lines.push("## Ringkasan");
    lines.push("| Severity | Jumlah |");
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

    lines.push("## Rincian per Kategori");
    for (const [category, catViolations] of Object.entries(byCategory)) {
      const catLabel = category
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      lines.push("");
      lines.push(`### ${catLabel} (${catViolations.length})`);
      lines.push("");
      lines.push("| Baris | Severity | Pesan |");
      lines.push("|-------|----------|-------|");

      // Urutkan berdasarkan baris
      catViolations.sort((a, b) => a.line - b.line);

      for (const v of catViolations) {
        const severityIcon = v.severity === "error" ? "Error" : v.severity === "warning" ? "Warning" : "Info";
        lines.push(`| ${v.line} | ${severityIcon} | ${escapeMd(v.message)} |`);
      }
    }

    lines.push("");

    // Daftar detail semua pelanggaran
    lines.push("## Detail Pelanggaran");
    lines.push("");
    for (let i = 0; i < violations.length; i++) {
      const v = violations[i];
      lines.push(`### ${i + 1}. ${v.category} — ${v.file}:${v.line}`);
      lines.push("");
      lines.push(`- **Kategori:** ${v.category}`);
      lines.push(`- **Severity:** ${v.severity}`);
      lines.push(`- **File:** ${v.file}`);
      lines.push(`- **Baris:** ${v.line}`);
      lines.push(`- **Pesan:** ${v.message}`);
      lines.push(`- **Ditemukan:** ${v.actual}`);
      lines.push(`- **Diharapkan:** ${v.expected}`);

      // Tambahkan saran perbaikan
      const fix = suggestFix(v);
      lines.push(`- **Saran:** ${fix.suggestedFix}`);
      lines.push("");
    }

    lines.push("---");
    lines.push(`*Laporan digenerate pada ${new Date().toISOString()}*`);
    lines.push("");
  } catch (error) {
    lines.push("Terjadi error saat memformat laporan.");
  }

  return lines.join("\n");
}

/**
 * Escape karakter Markdown khusus untuk tabel.
 */
function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Memformat profile proyek menjadi string human-readable (Markdown).
 *
 * @param profile - ProjectPatternProfile yang akan diformat
 * @returns string — representasi Markdown dari profile
 */
export function formatProfile(profile: ProjectPatternProfile): string {
  const lines: string[] = [];

  try {
    lines.push("# Project Pattern Profile");
    lines.push("");
    lines.push(`- **Dibuat:** ${profile.createdAt}`);
    lines.push(`- **Diupdate:** ${profile.updatedAt}`);
    lines.push("");

    lines.push("## Konvensi Penamaan");
    lines.push("");
    lines.push("| Bahasa | Style |");
    lines.push("|--------|-------|");
    for (const [lang, style] of Object.entries(profile.namingConventions)) {
      lines.push(`| ${lang} | ${style} |`);
    }
    lines.push("");

    lines.push("## Gaya Kode");
    lines.push("");
    lines.push(`- **Import Style:** ${profile.importStyle}`);
    lines.push(`- **Error Handling:** ${profile.errorHandling}`);
    lines.push(`- **File Organization:** ${profile.fileOrganization}`);
    lines.push(`- **Component Structure:** ${profile.componentStructure}`);
    lines.push(`- **Test Pattern:** ${profile.testPattern}`);
    lines.push("");

    lines.push("## Library Preferensi");
    lines.push("");
    if (profile.preferredLibs.length > 0) {
      for (const lib of profile.preferredLibs) {
        lines.push(`- \`${lib}\``);
      }
    } else {
      lines.push("Belum ada preferensi library yang terdeteksi.");
    }
    lines.push("");
  } catch (error) {
    lines.push("Terjadi error saat memformat profile.");
  }

  return lines.join("\n");
}

/**
 * Memformat hasil pembelajaran menjadi string human-readable.
 *
 * @param learned - LearnedPattern yang akan diformat
 * @returns string — representasi Markdown dari pola yang dipelajari
 */
export function formatLearnedPattern(learned: LearnedPattern): string {
  const lines: string[] = [];

  try {
    lines.push("# Pola yang Dipelajari");
    lines.push("");
    lines.push(`- **Pola:** ${learned.pattern}`);
    lines.push(`- **Kategori:** ${learned.category}`);
    lines.push(`- **Confidence:** ${(learned.confidence * 100).toFixed(0)}%`);
    lines.push(`- **Waktu:** ${learned.learnedAt}`);
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
 * Menghasilkan laporan konsistensi lengkap untuk satu atau banyak file.
 *
 * Menggabungkan hasil validasi, scoring, dan saran perbaikan
 * dalam satu objek report yang JSON-serializable.
 *
 * @param filePaths - Array path file yang akan divalidasi
 * @param profile - ProjectPatternProfile yang digunakan sebagai acuan
 * @returns ConsistencyReport — laporan lengkap dengan score, violations, dan suggestions
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
 * Memformat ConsistencyReport menjadi string human-readable (Markdown).
 *
 * @param report - ConsistencyReport yang akan diformat
 * @returns string — laporan dalam format Markdown
 */
export function formatConsistencyReport(report: ConsistencyReport): string {
  const lines: string[] = [];

  try {
    lines.push("# Laporan Konsistensi Kode");
    lines.push("");
    lines.push(`**Skor Konsistensi:** ${report.score}/100`);
    lines.push(`**Total Pelanggaran:** ${report.totalViolations}`);
    lines.push(`**Digenerate:** ${report.generatedAt}`);
    lines.push("");

    // Visual rating
    lines.push("## Rating");
    lines.push("");
    if (report.score >= 90) {
      lines.push("Kode sangat konsisten. Pertahankan!");
    } else if (report.score >= 70) {
      lines.push("Kode cukup konsisten. Beberapa area perlu perbaikan.");
    } else if (report.score >= 50) {
      lines.push("Kode perlu perbaikan konsistensi yang signifikan.");
    } else {
      lines.push("Kode sangat tidak konsisten. Perlu audit menyeluruh.");
    }
    lines.push("");

    if (report.bySeverity && Object.keys(report.bySeverity).length > 0) {
      lines.push("## Rincian Severity");
      lines.push("| Severity | Jumlah |");
      lines.push("|----------|--------|");
      for (const [sev, count] of Object.entries(report.bySeverity)) {
        lines.push(`| ${sev} | ${count} |`);
      }
      lines.push("");
    }

    if (report.byCategory && Object.keys(report.byCategory).length > 0) {
      lines.push("## Rincian Kategori");
      lines.push("| Kategori | Jumlah |");
      lines.push("|----------|--------|");
      for (const [cat, count] of Object.entries(report.byCategory)) {
        const catLabel = cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`| ${catLabel} | ${count} |`);
      }
      lines.push("");
    }

    if (report.violations && report.violations.length > 0) {
      lines.push("## Detail Pelanggaran");
      lines.push("");
      for (let i = 0; i < report.violations.length; i++) {
        const v = report.violations[i];
        lines.push(`### ${i + 1}. ${v.file}:${v.line}`);
        lines.push("");
        lines.push(`- **Kategori:** ${v.category}`);
        lines.push(`- **Severity:** ${v.severity}`);
        lines.push(`- **Pesan:** ${v.message}`);
        lines.push(`- **Ditemukan:** \`${v.actual}\``);
        lines.push(`- **Diharapkan:** \`${v.expected}\``);
        lines.push("");
      }
    }

    if (report.suggestions && report.suggestions.length > 0) {
      lines.push("## Saran Perbaikan");
      lines.push("");
      for (let i = 0; i < report.suggestions.length; i++) {
        const s = report.suggestions[i];
        lines.push(`### ${i + 1}. ${s.file}:${s.line}`);
        lines.push("");
        lines.push(`**Saran:** ${s.suggestedFix}`);
        lines.push("");
        lines.push(`**Alasan:** ${s.rationale}`);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push(`*Laporan digenerate pada ${report.generatedAt}*`);
    lines.push("");
  } catch (error) {
    lines.push("Terjadi error saat memformat laporan konsistensi.");
  }

  return lines.join("\n");
}

// ─── Log Management ─────────────────────────────────────────────────────────

/**
 * Membaca riwayat pelanggaran dari log.
 *
 * @param options - Filter opsi (limit, category, severity)
 * @returns ConsistencyViolation[] — daftar pelanggaran dari log
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
  } catch {
    return [];
  }
}

/**
 * Menghapus log pelanggaran.
 *
 * @returns boolean — true jika berhasil dihapus
 */
export function clearViolationLog(): boolean {
  try {
    const dir = ensureStorageDir();
    const logPath = join(dir, VIOLATIONS_LOG);
    if (!existsSync(logPath)) return false;
    writeFileSync(logPath, "", "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ─── Bulk Operations ───────────────────────────────────────────────────────

/**
 * Memindai dan memvalidasi seluruh direktori proyek terhadap profile.
 *
 * Melakukan walk pada direktori, menemukan semua file sumber,
 * memvalidasi masing-masing, dan mengembalikan laporan lengkap.
 *
 * @param root - Path absolut dari direktori proyek
 * @param profile - ProjectPatternProfile (opsional, akan auto-detect jika tidak ada)
 * @returns ConsistencyReport — laporan lengkap
 */
export function scanAndValidate(
  root: string,
  profile?: ProjectPatternProfile,
): ConsistencyReport {
  try {
    // Jika profile tidak diberikan, deteksi otomatis
    const activeProfile = profile ?? detectProjectPatterns(root);
    const files = collectSourceFiles(resolve(root));

    // Batasi untuk performa (max 200 file per scan)
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
 * Mendapatkan ringkasan profile dan stats dalam satu panggilan.
 *
 * @param root - Path absolut dari direktori proyek
 * @returns object berisi profile dan statistik
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

    // Cek kapan profile terakhir di-scan
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
export function learnFromEdit(
  originalContent: string,
  editedContent: string,
): LearnedPattern {
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
