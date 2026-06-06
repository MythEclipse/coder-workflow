#!/usr/bin/env node
/**
 * Tech Debt Tracker — Pelacak Utang Teknis
 *
 * Memindai proyek untuk TODO/FIXME/HACK, mengklasifikasikan secara otomatis,
 * dan menghasilkan laporan utang teknis yang terstruktur.
 *
 * Fitur:
 * 1. Memindai komentar TODO/FIXME/HACK dengan klasifikasi tipe dan severity
 * 2. Klasifikasi otomatis berdasarkan teks komentar
 * 3. Pelacakan per-module, per-tipe, dan skor utang
 * 4. Pengecekan budget utang teknis
 * 5. Mark resolved untuk item yang sudah diperbaiki
 * 6. Format laporan dan dashboard untuk human-readable output
 * 7. Penyimpanan persisten di .claude/tech-debt-tracker/
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * Tipe utang teknis yang terdeteksi.
 * - bug:       Masalah yang bisa menyebabkan error atau perilaku salah
 * - enhancement: Permintaan penambahan fitur atau peningkatan
 * - refactor:   Kode yang perlu di-refactor untuk maintainability
 * - documentation: Kekurangan atau ketidakakuratan dokumentasi
 * - security:   Potensi celah keamanan
 * - performance: Masalah performa atau optimalisasi
 */
export type DebtType = "bug" | "enhancement" | "refactor" | "documentation" | "security" | "performance";

/**
 * Tingkat keparahan utang teknis.
 * - critical: Berdampak besar, perlu segera diperbaiki
 * - major:    Berdampak signifikan, perlu dijadwalkan
 * - minor:    Berdampak kecil, bisa ditunda
 */
export type DebtSeverity = "critical" | "major" | "minor";

/**
 * Status siklus hidup item utang teknis.
 */
export type DebtStatus = "open" | "resolved";

/**
 * Representasi satu item utang teknis yang terdeteksi.
 */
export interface DebtEntry {
  /** ID unik untuk item ini */
  id: string;
  /** Timestamp ISO saat item pertama kali terdeteksi */
  timestamp: string;
  /** Path file relatif terhadap root proyek */
  file: string;
  /** Nomor baris dalam file */
  line: number;
  /** Klasifikasi tipe utang */
  type: DebtType;
  /** Tingkat keparahan */
  severity: DebtSeverity;
  /** Deskripsi atau pesan dari komentar */
  description: string;
  /** Author (dari git blame) */
  author?: string;
  /** Usia item dalam hari sejak commit terakhir menyentuh baris ini */
  age: number;
  /** Status apakah masih open atau sudah resolved */
  status: DebtStatus;
  /** Timestamp ISO saat di-resolve (undefined jika masih open) */
  resolvedAt?: string;
}

/**
 * Statistik agregat utang teknis.
 */
export interface DebtStats {
  /** Total item utang */
  total: number;
  /** Jumlah item per severity */
  bySeverity: Record<DebtSeverity, number>;
  /** Jumlah item per tipe */
  byType: Record<DebtType, number>;
  /** Jumlah item per module (directory level-1) */
  byModule: Record<string, number>;
  /** Skor utang kumulatif (critical=10, major=5, minor=1) */
  score: number;
  /** Rata-rata usia item dalam hari */
  averageAge: number;
  /** Jumlah item yang sudah di-resolve */
  resolved: number;
  /** Jumlah item yang masih open */
  open: number;
}

/**
 * Laporan utang teknis lengkap.
 */
export interface DebtReport {
  /** Total item yang dipindai */
  totalScanned: number;
  /** Daftar item utang */
  items: DebtEntry[];
  /** Statistik agregat */
  stats: DebtStats;
  /** Timestamp kapan laporan dibuat */
  generatedAt: string;
  /** Root directory yang dipindai */
  root: string;
}

/**
 * Hasil klasifikasi otomatis untuk sebuah teks komentar.
 */
export interface ClassificationResult {
  type: DebtType;
  severity: DebtSeverity;
}

/**
 * Hasil pengecekan budget utang teknis.
 */
export interface BudgetCheckResult {
  /** Apakah budget terlampaui */
  exceeded: boolean;
  /** Skor utang saat ini */
  currentScore: number;
  /** Ambang batas budget */
  threshold: number;
  /** Sisa budget (negatif jika terlampaui) */
  remaining: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

/** Directory penyimpanan data utang teknis */
const DEBT_DIR = ".claude/tech-debt-tracker";
/** File penyimpanan item utang */
const ITEMS_FILE = "items.json";
/** File history untuk perubahan status */
const HISTORY_FILE = "history.jsonl";

/** Bobot skor per severity */
const SEVERITY_WEIGHTS: Record<DebtSeverity, number> = {
  critical: 10,
  major: 5,
  minor: 1,
};

/** Pattern regex untuk mendeteksi komentar TODO/FIXME/HACK */
const DEBT_COMMENT_REGEX =
  /^(?:\/\/|#|<!--?|\/\*+| \*)\s*(TODO|FIXME|HACK|XXX|OPTIMIZE|REVIEW|SECURITY|PERF|WORKAROUND|KLUDGE|TEMP|WIP|TBD)\b\s*:?\s*(.*?)(?:\*\/|-->)?\s*$/im;

/** Ekstensi file yang akan dipindai */
const SCAN_EXTENSIONS = new Set([
  ".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".swift",
  ".rb", ".php", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".dart", ".scala",
  ".md", ".yaml", ".yml", ".json", ".toml",
  ".sql", ".sh", ".bash", ".zsh",
]);

/** Directory yang selalu dilewati saat pemindaian */
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", "build", ".next",
  ".turbo", "vendor", ".gradle", "generated",
  "coverage", ".nyc_output", ".claude",
  "target", "out", "bin", "obj",
]);

// ─── Storage ─────────────────────────────────────────────────────────────

/**
 * Memastikan directory storage ada, membuat jika belum.
 * @returns Path absolut ke directory storage
 */
function ensureStorageDir(): string {
  const dir = join(process.cwd(), DEBT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Memuat item utang dari penyimpanan.
 * @returns Daftar DebtEntry yang tersimpan
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
 * Menyimpan item utang ke penyimpanan.
 * @param items Daftar DebtEntry yang akan disimpan
 */
function saveItems(items: DebtEntry[]): void {
  const dir = ensureStorageDir();
  writeFileSync(join(dir, ITEMS_FILE), JSON.stringify(items, null, 2), "utf-8");
}

/**
 * Mencatat event ke file history (JSONL).
 * @param event Objek event yang akan dicatat
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
    // Non-critical, silent fail
  }
}

// ─── Git Blame Helpers ────────────────────────────────────────────────

/**
 * Mendapatkan author dari git blame untuk baris tertentu.
 * @param file Path absolut file
 * @param line Nomor baris
 * @returns Email author atau undefined jika gagal
 */
function blameAuthor(file: string, line: number): string | undefined {
  try {
    const { execFileSync } = require("node:child_process");
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
 * Mendapatkan tanggal commit terakhir untuk baris tertentu via git log.
 * @param file Path absolut file
 * @param line Nomor baris
 * @returns ISO date string atau undefined jika gagal
 */
function blameDate(file: string, line: number): string | undefined {
  try {
    const { execFileSync } = require("node:child_process");
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

// ─── Age Calculation ──────────────────────────────────────────────────

/**
 * Menghitung jumlah hari antara tanggal ISO dan sekarang.
 * @param isoDate String tanggal ISO
 * @returns Jumlah hari
 */
function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 0;
  const now = Date.now();
  const diffMs = now - then;
  return Math.floor(diffMs / 86_400_000);
}

// ─── Classification ───────────────────────────────────────────────────

/**
 * Pola kata kunci untuk mendeteksi tipe utang teknis.
 * Setiap tipe memiliki array pattern regex yang akan dicocokkan.
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
 * Pola kata kunci untuk mendeteksi tingkat keparahan.
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
 * Mengklasifikasikan teks komentar secara otomatis berdasarkan pola kata kunci.
 *
 * Fungsi ini mencocokkan teks komentar dengan pola yang sudah ditentukan
 * untuk menentukan tipe dan tingkat keparahan utang teknis.
 *
 * @param text Teks komentar yang akan diklasifikasikan
 * @returns Hasil klasifikasi berisi type dan severity
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

  // Hitung skor untuk setiap tipe
  let maxTypeScore = 0;
  for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        score += 2;
      }
    }
    // Bonus untuk keyword yang muncul di awal (seperti TODO, FIXME, dll)
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

  // Hitung skor untuk setiap severity
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

  // Jika tidak ada pola yang cocok, gunakan default berdasarkan prefix
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
    } else if (upper.startsWith("HACK") || upper.startsWith("KLUDGE") || upper.startsWith("WORKAROUND")) {
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
 * Berjalan secara rekursif melalui directory tree dan
 * mengumpulkan file-file dengan ekstensi yang dikenali.
 *
 * @param root Path root directory
 * @returns Daftar path absolut file yang ditemukan
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
 * Mengekstrak teks deskripsi dari komentar, membersihkan marker komentar.
 *
 * @param text Teks mentah dari komentar
 * @returns Teks yang sudah dibersihkan
 */
function extractDescription(text: string): string {
  return text
    .replace(/^\s*(?:\/\/|#|<!--?|\/\*+|\*+)\s*/, "")
    .replace(/\s*(?:\*\/|-->)?\s*$/, "")
    .trim();
}

/**
 * Mendapatkan nama module dari path file.
 * Module didefinisikan sebagai directory level-1 relatif terhadap root.
 *
 * @param filePath Path file relatif
 * @returns Nama module
 */
function getModuleName(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "(root)";
  return parts[0];
}

// ─── Core Scanning ────────────────────────────────────────────────────

/**
 * Memindai seluruh proyek untuk menemukan utang teknis.
 *
 * Fungsi ini membaca semua file source code, mencari komentar
 * TODO/FIXME/HACK/dll, mengklasifikasikannya, dan mengembalikan
 * daftar DebtEntry yang sudah di-enrich dengan author, tanggal, dan usia.
 *
 * @param root Path root proyek yang akan dipindai
 * @returns Array DebtEntry yang ditemukan
 *
 * @example
 * ```ts
 * const debts = scanForDebt("/path/to/project");
 * console.log(`Ditemukan ${debts.length} item utang teknis`);
 * ```
 */
export function scanForDebt(root: string): DebtEntry[] {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);

  // Muat item yang sudah ada untuk referensi (non-duplikasi)
  const existingItems = loadItems();
  const existingKeySet = new Set(existingItems.map((i) => `${i.file}:${i.line}`));

  const newItems: DebtEntry[] = [];
  const now = new Date().toISOString();

  for (const file of allFiles) {
    const relFile = relative(resolvedRoot, file);

    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];

      // Quick bail-out: harus mengandung marker komentar
      if (!/\/\/|#|<!--?|\/\*/.test(lineText)) continue;

      const match = DEBT_COMMENT_REGEX.exec(lineText);
      if (!match) continue;

      const rawTag = match[1].toUpperCase();
      const rawMessage = match[2] || "";
      const description = extractDescription(rawMessage || rawTag);
      const lineNum = i + 1;

      // Skip duplikasi
      const uniqueKey = `${relFile}:${lineNum}`;
      if (existingKeySet.has(uniqueKey)) continue;

      // Klasifikasi otomatis
      const classification = classifyDebt(description);

      // Enrich dengan git blame
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

  // Gabungkan item baru dengan yang sudah ada, update yang sudah ada
  const mergedItems = mergeItems(existingItems, newItems);
  saveItems(mergedItems);
  appendHistory({ event: "scan", found: newItems.length, total: mergedItems.length });

  return mergedItems;
}

/**
 * Menggabungkan item baru dengan item yang sudah ada.
 * Item yang sudah ada dipertahankan (termasuk status resolved).
 * Item baru ditambahkan. Item yang tidak lagi muncul di file
 * tetap disimpan (untuk referensi history), tapi bisa di-filter.
 *
 * @param existing Items yang sudah tersimpan
 * @param newItems Items baru dari hasil scan
 * @returns Array gabungan
 */
function mergeItems(existing: DebtEntry[], newItems: DebtEntry[]): DebtEntry[] {
  const existingMap = new Map<string, DebtEntry>();
  for (const item of existing) {
    const key = `${item.file}:${item.line}`;
    existingMap.set(key, item);
  }

  // Tambahkan item baru yang belum ada
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
 * Mendapatkan semua item utang yang masih open.
 *
 * @returns Array DebtEntry yang berstatus open
 */
export function getOpenDebts(): DebtEntry[] {
  return loadItems().filter((i) => i.status === "open");
}

/**
 * Mendapatkan daftar utang yang dikelompokkan per module.
 *
 * Module didefinisikan sebagai directory level-1.
 * Contoh: `src/`, `docs/`, `tests/`
 *
 * @returns Record dengan key nama module, value array DebtEntry
 *
 * @example
 * ```ts
 * const byModule = getDebtByModule();
 * for (const [module, items] of Object.entries(byModule)) {
 *   console.log(`${module}: ${items.length} item`);
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
 * Mendapatkan daftar utang yang dikelompokkan per tipe.
 *
 * @returns Record dengan key tipe utang, value array DebtEntry
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
 * Menghitung metrik dan skor utang teknis.
 *
 * Skor dihitung dengan bobot: critical = 10, major = 5, minor = 1.
 * Skor total memberikan gambaran umum tentang tingkat utang teknis.
 *
 * @returns DebtStats dengan semua metrik agregat
 *
 * @example
 * ```ts
 * const stats = getDebtScore();
 * console.log(`Skor utang: ${stats.score}`);
 * console.log(`Total item: ${stats.total}`);
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

  // Hitung skor kumulatif
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
 * Memeriksa apakah skor utang teknis melebihi ambang budget yang ditentukan.
 *
 * Budget threshold default adalah 100. Jika skor melebihi threshold,
 * maka dianggap perlu ada tindakan pengurangan utang teknis.
 *
 * @param threshold Ambang batas skor (default: 100)
 * @returns Boolean true jika melebihi budget
 *
 * @example
 * ```ts
 * if (isDebtBudgetExceeded(50)) {
 *   console.log("Budget utang teknis terlampaui!");
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
 * Menandai item utang sebagai resolved (selesai diperbaiki).
 *
 * Mencatat timestamp resolved dan menyimpan perubahan ke storage.
 *
 * @param id ID dari DebtEntry yang akan di-resolve
 * @returns Boolean true jika berhasil, false jika ID tidak ditemukan
 *
 * @example
 * ```ts
 * const success = markResolved("debt-1234567890-abc123");
 * if (success) console.log("Item berhasil di-resolve");
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
 * Membatalkan status resolved, mengembalikan item ke status open.
 *
 * @param id ID dari DebtEntry yang akan di-reopen
 * @returns Boolean true jika berhasil
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
 * Mendapatkan laporan utang teknis lengkap setelah melakukan scan.
 *
 * Menggabungkan hasil scan dengan statistik dan metadata laporan.
 *
 * @param root Path root proyek yang akan dipindai
 * @returns DebtReport dengan semua informasi
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
 * Memformat daftar item utang teknis menjadi tabel Markdown yang rapi.
 *
 * @param items Daftar DebtEntry yang akan diformat
 * @param stats Statistik utang (opsional, untuk ringkasan)
 * @returns String Markdown
 *
 * @example
 * ```ts
 * const report = formatDebtReport(debts, stats);
 * console.log(report);
 * ```
 */
export function formatDebtReport(items: DebtEntry[], stats?: DebtStats): string {
  const lines: string[] = [];

  lines.push("# Laporan Utang Teknis");
  lines.push("");

  if (stats) {
    lines.push(`**Total item:** ${stats.total} (${stats.open} open, ${stats.resolved} resolved)`);
    lines.push(`**Skor utang:** ${stats.score}`);
    lines.push(`**Rata-rata usia:** ${stats.averageAge} hari`);
    lines.push(`**Item kritis:** ${stats.bySeverity.critical}`);
    lines.push(`**Item major:** ${stats.bySeverity.major}`);
    lines.push("");
  }

  lines.push("## Detail Item");
  lines.push("");
  lines.push("| ID | File | Line | Tipe | Severity | Usia (hr) | Author | Deskripsi |");
  lines.push("|-----|------|------|------|----------|-----------|--------|-----------|");

  for (const item of items) {
    const idShort = item.id.slice(0, 16);
    const author = item.author ?? "-";
    const desc = escapeMarkdown(item.description.length > 60 ? item.description.slice(0, 60) + "..." : item.description);
    lines.push(`| ${idShort} | ${item.file} | ${item.line} | ${item.type} | ${item.severity} | ${item.age} | ${author} | ${desc} |`);
  }

  lines.push("");

  // Ringkasan berdasarkan tipe
  if (stats) {
    lines.push("## Ringkasan per Tipe");
    lines.push("");
    lines.push("| Tipe | Jumlah |");
    lines.push("|------|--------|");
    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      if (count > 0) {
        lines.push(`| ${type} | ${count} |`);
      }
    }
    lines.push("");

    // Ringkasan per severity
    lines.push("## Ringkasan per Severity");
    lines.push("");
    lines.push("| Severity | Jumlah | Bobot | Sub-skor |");
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
 * Membuat dashboard visual utang teknis dalam format Markdown.
 *
 * Dashboard menampilkan ringkasan visual dengan progress bar ASCII
 * untuk severity distribution, top modules, dan item paling tua.
 *
 * @param stats Statistik utang teknis dari getDebtScore()
 * @returns String Markdown dashboard
 *
 * @example
 * ```ts
 * const stats = getDebtScore();
 * console.log(formatDebtDashboard(stats));
 * ```
 */
export function formatDebtDashboard(stats: DebtStats): string {
  const lines: string[] = [];

  lines.push("# Dashboard Utang Teknis");
  lines.push("");
  lines.push(`> **Generated:** ${new Date().toISOString()}`);
  lines.push("");

  // Score card
  lines.push("## Skor Utang");
  lines.push("");
  lines.push(`\`\`\``);
  const barWidth = 30;
  const maxScore = Math.max(stats.score, 100);
  const filledBars = Math.round((stats.score / maxScore) * barWidth);
  const bar = "█".repeat(filledBars) + "░".repeat(Math.max(0, barWidth - filledBars));
  lines.push(`  Score: ${stats.score} / ${maxScore}`);
  lines.push(`  [${bar}]`);
  lines.push(`  Items: ${stats.total} (${stats.open} open, ${stats.resolved} resolved)`);
  lines.push(`  Rata-rata usia: ${stats.averageAge} hari`);
  lines.push(`\`\`\``);
  lines.push("");

  // Severity breakdown
  lines.push("## Breakdown Severity");
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
  lines.push("## Breakdown Tipe");
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
    lines.push("## Top Modules (5 teratas)");
    lines.push("");
    lines.push("```");
    const maxModuleCount = Math.max(modules[0][1], 1);
    for (const [mod, count] of modules.slice(0, 5)) {
      lines.push(formatBar(padEnd(mod, 20), count, maxModuleCount));
    }
    lines.push("```");
    lines.push("");
  }

  // Ringkasan
  lines.push("## Ringkasan");
  lines.push("");
  lines.push("| Metrik | Nilai |");
  lines.push("|--------|-------|");
  lines.push(`| Total item | ${stats.total} |`);
  lines.push(`| Open | ${stats.open} |`);
  lines.push(`| Resolved | ${stats.resolved} |`);
  lines.push(`| Skor utang | ${stats.score} |`);
  lines.push(`| Rata-rata usia | ${stats.averageAge} hari |`);
  lines.push(`| Item kritis | ${stats.bySeverity.critical} |`);
  lines.push(`| Item major | ${stats.bySeverity.major} |`);
  lines.push(`| Item minor | ${stats.bySeverity.minor} |`);

  return lines.join("\n");
}

// ─── Format Helpers ───────────────────────────────────────────────────

/**
 * Membuat progress bar ASCII horizontal.
 *
 * @param label Label untuk baris ini
 * @param value Nilai saat ini
 * @param max Nilai maksimum (untuk proporsi)
 * @param weight Bobot tampilan (untuk spacing)
 * @returns String baris dengan progress bar
 */
function formatBar(label: string, value: number, max: number, weight?: number): string {
  const barMax = 20;
  const filled = max > 0 ? Math.round((value / max) * barMax) : 0;
  const bar = "▓".repeat(filled) + "░".repeat(barMax - filled);
  const weightStr = weight !== undefined ? ` (×${weight})` : "";
  return `  ${label} ${bar} ${value}${weightStr}`;
}

/**
 * Menambahkan padding spasi di kanan string hingga panjang tertentu.
 *
 * @param str String yang akan dipadding
 * @param len Panjang target
 * @returns String dengan padding
 */
function padEnd(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

/**
 * Melakukan escape karakter Markdown yang bermakna khusus.
 *
 * @param text Teks yang akan di-escape
 * @returns Teks yang sudah di-escape
 */
function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "");
}

// ─── Cleanup ──────────────────────────────────────────────────────────

/**
 * Menghapus item utang yang sudah resolved lebih dari `daysOld` hari.
 *
 * Berguna untuk membersihkan history dari item lama yang sudah tidak relevan.
 *
 * @param daysOld Usia minimum resolved (dalam hari) untuk dihapus
 * @returns Jumlah item yang dihapus
 *
 * @example
 * ```ts
 * const deleted = cleanResolvedDebts(90); // Hapus resolved >90 hari
 * console.log(`${deleted} item dibersihkan`);
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
 * Mereset semua data utang teknis.
 *
 * Menghapus semua item dari storage. Gunakan dengan hati-hati.
 *
 * @returns Boolean true jika berhasil
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
 * Mengekspor seluruh data utang teknis sebagai JSON.
 *
 * @returns String JSON yang bisa diparsing oleh CLI
 *
 * @example
 * ```ts
 * const json = exportDebtJSON();
 * console.log(json); // output ke stdout
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
