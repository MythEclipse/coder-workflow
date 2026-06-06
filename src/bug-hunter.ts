#!/usr/bin/env node
/**
 * Bug Hunter — Detektor pola bug otomatis untuk source code.
 *
 * Memindai file, direktori, dan git diff untuk mendeteksi pola-pola
 * yang dikenal sebagai sumber bug umum. Hasil deteksi disimpan dalam
 * format JSONL di .claude/bug-hunter/findings.jsonl untuk analisis
 * lebih lanjut.
 *
 * Arsitektur:
 * 1. Built-in patterns mencakup 6 kategori: null-safety, error-handling,
 *    boundary, security, async, performance.
 * 2. scan*() functions memindai konten dan mencocokkan dengan pattern aktif.
 * 3. Hasil temuan disimpan ke file JSONL untuk persistensi.
 * 4. Format*() functions menghasilkan output human-readable.
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

// ─── Types ───────────────────────────────────────────────────────────────
/**
 * Representasi kategori pola bug.
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
 * Representasi tingkat keparahan bug.
 */
export type BugSeverity = "critical" | "high" | "medium" | "low";

/**
 * Representasi pola bug yang akan dideteksi.
 */
export interface BugPattern {
  /** ID unik untuk pola ini (digunakan untuk suppress) */
  id: string;
  /** Nama deskriptif pola bug */
  name: string;
  /** Penjelasan singkat tentang pola ini */
  description: string;
  /** Tingkat keparahan */
  severity: BugSeverity;
  /** Pattern regex atau string literal untuk mencocokkan kode */
  pattern: RegExp;
  /** Bahasa pemrograman yang relevan */
  languages: string[];
  /** Kategori pola */
  category: BugCategory;
  /** Saran perbaikan umum */
  suggestedFix: string;
  /** Apakah pattern sedang aktif (bisa di-nonaktifkan) */
  active: boolean;
}

/**
 * Representasi satu temuan bug dalam file.
 */
export interface BugFinding {
  /** Path file tempat bug ditemukan */
  file: string;
  /** Nomor baris tempat pola cocok */
  line: number;
  /** ID pattern yang cocok */
  pattern: string;
  /** Tingkat keparahan */
  severity: BugSeverity;
  /** Deskripsi temuan */
  description: string;
  /** Saran perbaikan spesifik untuk temuan ini */
  suggestedFix: string;
  /** Konten baris yang bermasalah */
  content: string;
  /** Timestamp deteksi */
  timestamp: string;
}

/**
 * Laporan bug lengkap untuk satu sesi scan.
 */
export interface BugReport {
  /** Total temuan */
  totalFindings: number;
  /** Daftar temuan */
  findings: BugFinding[];
  /** Breakdown berdasarkan severity */
  bySeverity: Record<string, number>;
  /** Breakdown berdasarkan kategori */
  byCategory: Record<string, number>;
  /** Breakdown berdasarkan file */
  byFile: Record<string, number>;
  /** Jumlah file yang di-scan */
  filesScanned: number;
  /** Timestamp laporan */
  timestamp: string;
}

/**
 * Statistik dari storage historis.
 */
export interface BugHunterStats {
  /** Total temuan sepanjang masa */
  totalFindings: number;
  /** Jumlah file yang pernah di-scan */
  totalFilesScanned: number;
  /** Temuan un-resolved */
  unresolvedFindings: number;
  /** Pattern yang sedang aktif */
  activePatterns: number;
  /** Pattern yang di-suppress */
  suppressedPatterns: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

const STORAGE_DIR = ".claude/bug-hunter";
const FINDINGS_FILE = "findings.jsonl";
const SUPPRESSED_FILE = "suppressed.json";

/**
 * Extension file yang didukung untuk scanning.
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
 * Direktori yang selalu dilewati saat scan.
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
 * Mendapatkan daftar built-in pattern bug yang akan dideteksi.
 * Mencakup 6 kategori dengan total lebih dari 15 pattern.
 *
 * @returns {BugPattern[]} Daftar pattern bug default
 */
export function getBugPatterns(): BugPattern[] {
  return [
    // ── Null Safety ────────────────────────────────────────────────────
    {
      id: "null-nullable-no-check",
      name: "Nullable tanpa null check",
      description:
        "Mengakses properti atau method dari nilai nullable tanpa melakukan null check terlebih dahulu",
      severity: "critical",
      pattern: /\b(\w+)(\.\w+)+\b(?!\s*\?\.)(?<![?!])/,
      languages: ["ts", "js", "kt", "swift"],
      category: "null-safety",
      suggestedFix:
        "Gunakan optional chaining (?.) atau tambahkan null guard (if/guard) sebelum akses",
      active: true,
    },
    {
      id: "null-bang-without-guard",
      name: "Non-null assertion (!) tanpa guard",
      description:
        "Menggunakan operator non-null assertion (!) tanpa memastikan nilai tidak null sebelumnya",
      severity: "high",
      pattern: /\b\w+!\s*\./,
      languages: ["ts"],
      category: "null-safety",
      suggestedFix:
        "Gunakan optional chaining (?.) atau validasi terlebih dahulu dengan if statement",
      active: true,
    },
    {
      id: "null-assign-nullable-to-nonnull",
      name: "Nullable di-assign ke non-null tanpa check",
      description: "Meng-assign nilai nullable ke variabel non-null tanpa validasi",
      severity: "high",
      pattern: /const\s+\w+\s*[=:]\s*\w+\??\./,
      languages: ["ts", "js", "kt"],
      category: "null-safety",
      suggestedFix:
        "Gunakan null coalescing (??) dengan default value atau tambahkan null check sebelum assignment",
      active: true,
    },

    // ── Error Handling ─────────────────────────────────────────────────
    {
      id: "err-empty-catch",
      name: "Catch block kosong",
      description: "Blok catch yang kosong menelan error tanpa penanganan atau logging",
      severity: "medium",
      pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
      languages: ["ts", "js", "java", "kt", "cpp", "swift", "rb", "php"],
      category: "error-handling",
      suggestedFix:
        "Log error ke console atau throw ulang dengan pesan yang lebih deskriptif. Jangan biarkan catch kosong.",
      active: true,
    },
    {
      id: "err-promise-without-catch",
      name: "Promise tanpa .catch()",
      description: "Panggilan Promise tanpa menambahkan .catch() untuk menangani rejection",
      severity: "high",
      pattern: /\.then\s*\([^)]*\)\s*(?!\s*\.\s*catch\b)/,
      languages: ["ts", "js"],
      category: "error-handling",
      suggestedFix: "Tambahkan .catch() handler di akhir Promise chain untuk menangani rejection",
      active: true,
    },
    {
      id: "err-async-without-try",
      name: "Async function tanpa try/catch",
      description:
        "Fungsi async yang tidak memiliki blok try/catch untuk menangani promise rejection",
      severity: "medium",
      pattern: /async\s+(?:function\s+\w+\s*)?\([^)]*\)\s*\{[^}]*(?!try)/,
      languages: ["ts", "js", "py"],
      category: "error-handling",
      suggestedFix: "Bungkus kode dalam blok try/catch untuk menangani potential rejection",
      active: true,
    },
    {
      id: "err-throw-literal",
      name: "Throw non-Error literal",
      description:
        "Melempar exception dengan tipe non-Error (string, number, object) yang kehilangan stack trace",
      severity: "medium",
      pattern: /throw\s+(['"`]|\d+|null\b|undefined\b)/,
      languages: ["ts", "js", "java", "kt", "cpp"],
      category: "error-handling",
      suggestedFix: "Gunakan 'throw new Error(\"...\")' agar stack trace terekam dengan baik",
      active: true,
    },

    // ── Boundary ───────────────────────────────────────────────────────
    {
      id: "bnd-array-index-without-length",
      name: "Akses array index tanpa length check",
      description:
        "Mengakses elemen array dengan index tanpa memeriksa panjang array terlebih dahulu",
      severity: "high",
      pattern: /\b\w+\[\s*\w+\s*\]/,
      languages: ["ts", "js", "java", "kt", "go", "rs", "cpp", "py", "rb", "php"],
      category: "boundary",
      suggestedFix:
        "Periksa panjang array (array.length) sebelum mengakses index, atau gunakan optional chaining array.at()",
      active: true,
    },
    {
      id: "bnd-division-without-zero-guard",
      name: "Division tanpa zero guard",
      description: "Operasi pembagian tanpa memeriksa apakah penyebut bernilai nol",
      severity: "critical",
      pattern: /\b\w+\s*\/\s*\w+\b/,
      languages: ["ts", "js", "java", "kt", "go", "rs", "cpp", "py", "rb", "php"],
      category: "boundary",
      suggestedFix: "Tambahkan guard clause untuk memastikan penyebut tidak nol sebelum pembagian",
      active: true,
    },
    {
      id: "bnd-substring-without-length",
      name: "Substring/Substr tanpa boundary check",
      description: "Pemotongan string menggunakan substring/substr tanpa memeriksa panjang string",
      severity: "medium",
      pattern: /\.substring\s*\(|\.substr\s*\(|\.slice\s*\(/,
      languages: ["ts", "js", "java", "kt"],
      category: "boundary",
      suggestedFix:
        "Pastikan panjang string memenuhi batas minimal sebelum melakukan pemotongan, atau gunakan Math.min() untuk clamp",
      active: true,
    },

    // ── Security ───────────────────────────────────────────────────────
    {
      id: "sec-sql-concatenation",
      name: "SQL string concatenation",
      description: "Membangun query SQL dengan concatenation string yang rentan SQL injection",
      severity: "critical",
      pattern: /(?:query|execute|run)\s*\(\s*[`'"]\s*\+\s*/,
      languages: ["ts", "js", "py", "rb", "php", "java", "go"],
      category: "security",
      suggestedFix:
        "Gunakan parameterized query / prepared statement untuk menghindari SQL injection",
      active: true,
    },
    {
      id: "sec-eval-usage",
      name: "Penggunaan eval() atau Function()",
      description:
        "Menggunakan eval() atau constructor Function() yang mengeksekusi string sebagai kode — sangat berbahaya",
      severity: "critical",
      pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
      languages: ["ts", "js", "py"],
      category: "security",
      suggestedFix:
        "Hindari eval(). Gunakan parser yang aman atau pendekatan alternatif untuk kebutuhan runtime evaluation",
      active: true,
    },
    {
      id: "sec-innerhtml",
      name: "innerHTML / outerHTML assignment",
      description: "Meng-assign user input langsung ke innerHTML yang rentan XSS attack",
      severity: "critical",
      pattern: /\.innerHTML\s*=|\.outerHTML\s*=|\.insertAdjacentHTML\s*\(/,
      languages: ["ts", "js", "tsx", "jsx"],
      category: "security",
      suggestedFix:
        "Gunakan textContent untuk teks biasa, atau sanitasi input terlebih dahulu sebelum memasukkan ke innerHTML",
      active: true,
    },
    {
      id: "sec-hardcoded-secret",
      name: "Hardcoded credential/secret",
      description: "Kredensial, API key, atau token hardcoded langsung di source code",
      severity: "critical",
      pattern:
        /(?:api[_-]?key|apikey|secret|password|token|credential)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
      languages: ["ts", "js", "py", "go", "rs", "java", "rb", "php"],
      category: "security",
      suggestedFix:
        "Gunakan environment variable atau secret management service untuk menyimpan kredensial",
      active: true,
    },

    // ── Async ──────────────────────────────────────────────────────────
    {
      id: "async-callback-without-error",
      name: "Callback tanpa error argument",
      description:
        "Callback function yang tidak memiliki parameter error (Node.js callback convention)",
      severity: "medium",
      pattern: /\bcb\s*\([^)]*\w+\s*\)|\bcallback\s*\([^)]*\w+\s*\)/,
      languages: ["ts", "js"],
      category: "async",
      suggestedFix:
        "Ikuti Node.js callback convention: callback(error, result). Parameter error harus ada untuk menangani failure.",
      active: true,
    },
    {
      id: "async-missing-await",
      name: "Missing await pada Promise call",
      description:
        "Memanggil async function tanpa await, sehingga Promise tidak di-resolve sebelum digunakan",
      severity: "high",
      pattern:
        /(?:await\s+)?\b\w+\s*=\s*\w+\([^)]*\)\s*;\s*\n\s*\w+\.(?:then|catch|finally)\b(?!.*\bawait\b)/,
      languages: ["ts", "js"],
      category: "async",
      suggestedFix:
        "Tambahkan await sebelum pemanggilan async function, atau gunakan .then() chain",
      active: true,
    },
    {
      id: "async-promise-in-promise",
      name: "Promise di dalam Promise (nested)",
      description:
        "Membuat Promise baru di dalam executor Promise lain yang menyebabkan callback hell",
      severity: "low",
      pattern: /new\s+Promise\s*\([^)]*\)[^;]*\bnew\s+Promise\b/,
      languages: ["ts", "js"],
      category: "async",
      suggestedFix:
        "Gunakan Promise chaining (.then()) atau async/await untuk menghindari Promise bersarang",
      active: true,
    },

    // ── Performance ────────────────────────────────────────────────────
    {
      id: "perf-nested-loops",
      name: "Nested loop O(n²) potensial",
      description:
        "Loop bersarang (nested for/forEach) yang berpotensi O(n²) dan bisa menjadi bottleneck",
      severity: "low",
      pattern: /(?:for\s*\([^)]+\)[\s\S]*?for\s*\(|forEach\s*\([^)]*\)[\s\S]*?forEach\s*\()/,
      languages: ["ts", "js", "java", "kt", "go", "rs", "cpp", "py", "rb", "php"],
      category: "performance",
      suggestedFix:
        "Gunakan Map/Set untuk lookup O(1) atau restrukturisasi algoritma untuk menghindari O(n²)",
      active: true,
    },
    {
      id: "perf-large-array-spread",
      name: "Large array spread operator",
      description:
        "Menggunakan spread operator (...) untuk menggabungkan array besar, mengalokasi memori baru",
      severity: "low",
      pattern: /\[\s*\.\.\.\s*\w+\s*,\s*\.\.\.\s*\w+/,
      languages: ["ts", "js", "tsx", "jsx"],
      category: "performance",
      suggestedFix:
        "Gunakan .push() dengan spread atau array mutation methods untuk array yang sangat besar",
      active: true,
    },
  ];
}

// ─── Storage Functions ────────────────────────────────────────────────────

/**
 * Memastikan direktori storage bug-hunter ada.
 * Membuat direktori jika belum ada.
 *
 * @returns {string} Path absolut ke direktori storage
 */
function ensureStorageDir(): string {
  const dir = join(process.cwd(), STORAGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Load daftar ID pattern yang di-suppress dari file storage.
 *
 * @returns {string[]} Daftar ID pattern yang dinonaktifkan
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
 * Menyimpan daftar ID pattern yang di-suppress ke file storage.
 *
 * @param {string[]} ids - Daftar ID pattern yang dinonaktifkan
 */
function saveSuppressedPatterns(ids: string[]): void {
  const dir = ensureStorageDir();
  writeFileSync(join(dir, SUPPRESSED_FILE), JSON.stringify(ids, null, 2), "utf-8");
}

// ─── Pattern Management ───────────────────────────────────────────────────

/**
 * Non-aktifkan pattern tertentu dari deteksi.
 * ID pattern yang di-suppress disimpan ke .claude/bug-hunter/suppressed.json.
 *
 * @param {string} patternId - ID pattern yang akan dinonaktifkan
 * @throws {Error} Jika patternId tidak ditemukan di daftar built-in patterns
 */
export function suppressPattern(patternId: string): void {
  const patterns = getBugPatterns();
  const exists = patterns.some((p) => p.id === patternId);

  if (!exists) {
    throw new Error(
      `Pattern dengan ID "${patternId}" tidak ditemukan. Gunakan getBugPatterns() untuk melihat daftar pattern yang tersedia.`,
    );
  }

  const suppressed = loadSuppressedPatterns();
  if (!suppressed.includes(patternId)) {
    suppressed.push(patternId);
    saveSuppressedPatterns(suppressed);
  }
}

/**
 * Aktifkan kembali pattern yang sebelumnya di-suppress.
 *
 * @param {string} patternId - ID pattern yang akan diaktifkan kembali
 */
export function unsuppressPattern(patternId: string): void {
  const suppressed = loadSuppressedPatterns().filter((id) => id !== patternId);
  saveSuppressedPatterns(suppressed);
}

/**
 * Mendapatkan daftar pattern aktif (tidak di-suppress).
 *
 * @returns {BugPattern[]} Daftar pattern yang aktif untuk deteksi
 */
function getActivePatterns(): BugPattern[] {
  const suppressed = new Set(loadSuppressedPatterns());
  return getBugPatterns().filter((p) => p.active && !suppressed.has(p.id));
}

// ─── Core Scanning Logic ──────────────────────────────────────────────────

/**
 * Memeriksa apakah ekstensi file didukung untuk scanning.
 *
 * @param {string} filePath - Path file
 * @returns {boolean} true jika ekstensi didukung
 */
function isSupportedFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Mendapatkan bahasa dari ekstensi file.
 *
 * @param {string} filePath - Path file
 * @returns {string} Nama bahasa pemrograman
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
 * Memindai satu baris konten terhadap semua pattern aktif.
 *
 * @param {string} content - Konten baris
 * @param {number} lineNumber - Nomor baris (1-based)
 * @param {string} filePath - Path file sumber
 * @param {string} language - Bahasa pemrograman
 * @param {BugPattern[]} patterns - Daftar pattern aktif
 * @returns {BugFinding[]} Temuan yang cocok untuk baris ini
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
    // Skip jika bahasa tidak relevan
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
      // Skip pattern yang regex-nya error
      continue;
    }
  }

  return findings;
}

// ─── Public Scan Functions ────────────────────────────────────────────────

/**
 * Memindai konten git diff untuk mendeteksi pola bug.
 * Berguna untuk pre-commit hook dan code review.
 *
 * @param {string} diffContent - Konten git diff (output dari git diff)
 * @param {string} language - Bahasa pemrograman (ts, js, py, dll)
 * @returns {BugFinding[]} Daftar temuan bug dalam diff
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

      // Track file yang sedang di-diff
      const fileMatch = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        continue;
      }

      // Hanya scan baris tambahan (diawali +)
      if (!line.startsWith("+") || line.startsWith("+++")) continue;

      const contentLine = line.slice(1).trim(); // buang leading +
      if (!contentLine) continue;

      const lineFindings = scanLine(contentLine, i + 1, currentFile, language, patterns);
      findings.push(...lineFindings);
    }
  } catch (error) {
    // Silent fail - return temuan yang sudah didapat
  }

  return findings;
}

/**
 * Memindai satu file untuk mendeteksi pola bug.
 * Membaca file dari disk dan mengecek setiap baris terhadap pattern aktif.
 *
 * @param {string} filePath - Path absolut ke file yang akan di-scan
 * @returns {BugFinding[]} Daftar temuan bug dalam file
 */
export function scanFileForBugs(filePath: string): BugFinding[] {
  const findings: BugFinding[] = [];

  try {
    // Validasi file
    if (!existsSync(filePath)) {
      throw new Error(`File tidak ditemukan: ${filePath}`);
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

    // Simpan temuan ke storage
    if (findings.length > 0) {
      appendFindings(findings);
    }
  } catch (error) {
    // Throw biar caller bisa handle
    throw error;
  }

  return findings;
}

/**
 * Memindai seluruh direktori untuk mendeteksi pola bug.
 * Rekursif mencari file dengan ekstensi yang didukung.
 *
 * @param {string} dirPath - Path absolut ke direktori yang akan di-scan
 * @returns {BugFinding[]} Daftar temuan bug di seluruh direktori
 */
export function scanDirectoryForBugs(dirPath: string): BugFinding[] {
  const allFindings: BugFinding[] = [];

  try {
    const resolvedPath = resolve(dirPath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Direktori tidak ditemukan: ${dirPath}`);
    }

    const files = walkFiles(resolvedPath);

    for (const file of files) {
      try {
        const fileFindings = scanFileForBugs(file);
        allFindings.push(...fileFindings);
      } catch {
        // Skip file yang gagal di-scan
        continue;
      }
    }
  } catch (error) {
    throw error;
  }

  return allFindings;
}

/**
 * Rekursif mengumpulkan file-file yang didukung dari direktori.
 *
 * @param {string} root - Path direktori root
 * @returns {string[]} Daftar path file yang ditemukan
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
    // Return hasil yang sudah didapat
  }

  return result;
}

// ─── Storage ──────────────────────────────────────────────────────────────

/**
 * Menyimpan temuan ke file JSONL storage.
 *
 * @param {BugFinding[]} findings - Daftar temuan yang akan disimpan
 */
function appendFindings(findings: BugFinding[]): void {
  const dir = ensureStorageDir();
  const filePath = join(dir, FINDINGS_FILE);

  try {
    for (const finding of findings) {
      appendFileSync(filePath, JSON.stringify(finding) + "\n", "utf-8");
    }
  } catch {
    // Non-critical — tetap return findings walau gagal simpan
  }
}

/**
 * Membaca semua temuan dari file storage JSONL.
 *
 * @param {object} [options] - Filter opsi
 * @param {BugSeverity} [options.severity] - Filter berdasarkan severity
 * @param {number} [options.limit] - Batas jumlah temuan yang direturn
 * @returns {BugFinding[]} Daftar temuan dari storage
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
    // Return kosong jika gagal baca
  }

  // Sort by timestamp descending
  findings.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return options?.limit ? findings.slice(0, options.limit) : findings;
}

// ─── Report Building ──────────────────────────────────────────────────────

/**
 * Membangun laporan bug dari daftar temuan.
 *
 * @param {BugFinding[]} findings - Daftar temuan
 * @param {number} [filesScanned=0] - Jumlah file yang di-scan
 * @returns {BugReport} Laporan bug terstruktur
 */
export function buildReport(findings: BugFinding[], filesScanned: number = 0): BugReport {
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byFile: Record<string, number> = {};

  // Ambil data kategori dari pattern
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
 * Memformat satu temuan bug menjadi string human-readable.
 *
 * @param {BugFinding} finding - Temuan yang akan diformat
 * @returns {string} Representasi string dari temuan
 */
export function formatFinding(finding: BugFinding): string {
  const severityTag = getSeverityTag(finding.severity);

  return [
    `${severityTag} [${finding.pattern}] ${finding.file}:${finding.line}`,
    `     Deskripsi: ${finding.description}`,
    `     Kode:      ${finding.content}`,
    `     Saran:     ${finding.suggestedFix}`,
  ].join("\n");
}

/**
 * Memformat daftar temuan menjadi laporan lengkap human-readable.
 *
 * @param {BugFinding[]} findings - Daftar temuan
 * @param {number} [filesScanned=0] - Jumlah file yang di-scan
 * @returns {string} Laporan lengkap dalam format string
 */
export function formatBugReport(findings: BugFinding[], filesScanned: number = 0): string {
  if (findings.length === 0) {
    return [
      "# Bug Hunter Report",
      "",
      "**Selamat! Tidak ada bug pattern yang terdeteksi.**",
      "",
      `File di-scan: ${filesScanned}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join("\n");
  }

  const report = buildReport(findings, filesScanned);
  const lines: string[] = [];

  lines.push("# Bug Hunter Report");
  lines.push("");
  lines.push(`**Total temuan:** ${report.totalFindings}`);
  lines.push(`**File di-scan:** ${report.filesScanned}`);
  lines.push(`**Timestamp:** ${report.timestamp}`);
  lines.push("");

  // Summary by severity
  lines.push("## Ringkasan berdasarkan Severity");
  lines.push("| Severity | Jumlah |");
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
  lines.push("## Ringkasan berdasarkan Kategori");
  lines.push("| Kategori | Jumlah |");
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
  lines.push("## Berdasarkan File (Top 10)");
  lines.push("| File | Temuan |");
  lines.push("|------|--------|");
  const topFiles = Object.entries(report.byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [file, count] of topFiles) {
    lines.push(`| ${file} | ${count} |`);
  }
  lines.push("");

  // Detail temuan
  lines.push("## Detail Temuan");
  for (const finding of findings) {
    lines.push("");
    lines.push(formatFinding(finding));
  }

  return lines.join("\n");
}

/**
 * Mendapatkan tag severity untuk ditampilkan di output.
 *
 * @param {BugSeverity} severity - Tingkat severity
 * @returns {string} Tag severity dalam format string
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
 * Mendapatkan label severity yang lebih deskriptif.
 *
 * @param {BugSeverity} severity - Tingkat severity
 * @returns {string} Label severity
 */
function getSeverityLabel(severity: BugSeverity): string {
  const labels: Record<BugSeverity, string> = {
    critical: "Critical — harus segera diperbaiki",
    high: "High — prioritas tinggi",
    medium: "Medium — perlu diperhatikan",
    low: "Low — best practice",
  };
  return labels[severity] ?? severity;
}

// ─── Stats ────────────────────────────────────────────────────────────────

/**
 * Mendapatkan statistik dari storage bug-hunter.
 *
 * @returns {BugHunterStats} Statistik lengkap
 */
export function getBugHunterStats(): BugHunterStats {
  const findings = getStoredFindings();
  const suppressed = loadSuppressedPatterns();
  const allPatterns = getBugPatterns();

  // Hitung unresolved findings (yang severity-nya masih high/critical)
  const unresolvedFindings = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;

  // Estimasi unique files dari stored findings
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
 * Entry point untuk CLI. Memproses argumen command line dan
 * menjalankan operasi yang diminta.
 *
 * Argumen yang didukung:
 * - file <path>: Scan satu file
 * - dir <path>: Scan direktori
 * - diff <lang>: Scan dari stdin (diff content)
 * - list: Tampilkan daftar pattern
 * - suppress <id>: Non-aktifkan pattern
 * - unsuppress <id>: Aktifkan kembali pattern
 * - stats: Tampilkan statistik
 *
 * @param {string[]} args - Argumen CLI
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

        // Baca dari stdin
        const stdin = readFileSync("/dev/stdin", "utf-8");
        diffContent = stdin;

        const findings = scanDiffForBugs(diffContent, language);
        console.log(formatBugReport(findings));
        break;
      }

      case "list": {
        const patterns = getBugPatterns();
        const suppressed = new Set(loadSuppressedPatterns());

        console.log("# Bug Hunter — Daftar Pattern");
        console.log(`\nTotal pattern: ${patterns.length}`);
        console.log(`Aktif: ${patterns.length - suppressed.size}`);
        console.log(`Di-suppress: ${suppressed.size}\n`);

        for (const pattern of patterns) {
          const status = pattern.active && !suppressed.has(pattern.id) ? "[AKTIF]" : "[OFF]";
          console.log(`${status} ${pattern.id}`);
          console.log(`     Nama:        ${pattern.name}`);
          console.log(`     Severity:    ${pattern.severity}`);
          console.log(`     Kategori:    ${pattern.category}`);
          console.log(`     Bahasa:      ${pattern.languages.join(", ")}`);
          console.log(`     Deskripsi:   ${pattern.description}`);
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
        console.log(`Pattern "${patternId}" telah dinonaktifkan.`);
        break;
      }

      case "unsuppress": {
        const patternId = args[1];
        if (!patternId) {
          console.error("Usage: bug-hunter unsuppress <pattern-id>");
          process.exit(1);
        }
        unsuppressPattern(patternId);
        console.log(`Pattern "${patternId}" telah diaktifkan kembali.`);
        break;
      }

      case "stats": {
        const stats = getBugHunterStats();
        console.log("# Bug Hunter — Statistik");
        console.log(`\nTotal temuan tersimpan: ${stats.totalFindings}`);
        console.log(`File pernah di-scan:    ${stats.totalFilesScanned}`);
        console.log(`Temuan unresolved:      ${stats.unresolvedFindings}`);
        console.log(`Pattern aktif:          ${stats.activePatterns}`);
        console.log(`Pattern di-suppress:    ${stats.suppressedPatterns}`);
        break;
      }

      default: {
        console.log(`
Bug Hunter — Detektor pola bug otomatis

Penggunaan:
  bug-hunter file <path>         Scan satu file
  bug-hunter dir [path]          Scan direktori (default: cwd)
  bug-hunter diff <language>     Scan diff dari stdin
  bug-hunter list                Tampilkan daftar pattern
  bug-hunter suppress <id>       Non-aktifkan pattern
  bug-hunter unsuppress <id>     Aktifkan kembali pattern
  bug-hunter stats               Tampilkan statistik storage

Contoh:
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
