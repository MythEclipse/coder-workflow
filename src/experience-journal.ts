#!/usr/bin/env node
/**
 * Buku Harian Pengalaman (Experience Journal) — Rekam jejak task completion,
 * failure, dan keputusan untuk pembelajaran berkelanjutan.
 *
 * Menyimpan data di .claude/experience-journal/entries.jsonl dan decisions.jsonl
 * dengan format JSONL (satu JSON per baris).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Tipe Data
// ---------------------------------------------------------------------------

/** Hasil akhir dari sebuah task. */
export type ExperienceOutcome = "success" | "failure" | "partial";

/**
 * Rekaman keputusan arsitektural atau teknis.
 */
export interface DecisionRecord {
  /** ID unik keputusan. */
  id: string;
  /** Timestamp ISO 8601 pembuatan keputusan. */
  timestamp: string;
  /** Konteks saat keputusan dibuat. */
  context: string;
  /** Opsi-opsi yang dipertimbangkan. */
  options: string[];
  /** Opsi yang dipilih. */
  selected: string;
  /** Alasan pemilihan opsi tersebut. */
  rationale: string;
  /** Outcome keputusan setelah dievaluasi (opsional). */
  outcome?: ExperienceOutcome;
}

/**
 * Rekaman sebuah task completion.
 */
export interface ExperienceEntry {
  /** ID unik entry. */
  id: string;
  /** Timestamp ISO 8601. */
  timestamp: string;
  /** Tipe task (misal: "implement", "debug", "refactor", "test", "deploy"). */
  taskType: string;
  /** Deskripsi singkat task. */
  taskDesc: string;
  /** Hasil akhir task. */
  outcome: ExperienceOutcome;
  /** Akar penyebab kegagalan (jika outcome=failure). */
  rootCause?: string;
  /** Pelajaran yang dipetik. */
  lessons: string[];
  /** Pola-pola yang teridentifikasi. */
  patterns: string[];
  /** Keputusan yang dibuat selama task. */
  decisions: DecisionRecord[];
  /** Tag untuk kategorisasi. */
  tags: string[];
}

/**
 * Statistik ringkas dari journal.
 */
export interface Stats {
  /** Total entry di journal. */
  total: number;
  /** Jumlah entry per outcome. */
  byOutcome: Record<ExperienceOutcome, number>;
  /** Pola-pola yang paling sering muncul. */
  topPatterns: Array<{ pattern: string; frequency: number; avgSuccessRate: number }>;
  /** Keputusan terbaru. */
  recentDecisions: DecisionRecord[];
}

// ---------------------------------------------------------------------------
// Konstanta
// ---------------------------------------------------------------------------

/** Direktori penyimpanan journal. */
const JOURNAL_DIR = ".claude/experience-journal";

/** File rekaman entries. */
const ENTRIES_FILE = "entries.jsonl";

/** File rekaman keputusan. */
const DECISIONS_FILE = "decisions.jsonl";

/** Jumlah maksimal hasil query default. */
const DEFAULT_QUERY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Pastikan direktori journal ada. Buat jika belum ada.
 *
 * @returns {string} Path absolut ke direktori journal
 */
function ensureJournalDir(): string {
  const dir = resolve(join(process.cwd(), JOURNAL_DIR));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Generate ID unik.
 *
 * @param {string} prefix — Prefix ID
 * @returns {string} ID unik
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Parse timestamp ISO ke epoch milliseconds.
 *
 * @param {string} iso — Timestamp ISO 8601
 * @returns {number} Epoch milliseconds
 */
function parseTimestamp(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// ---------------------------------------------------------------------------
// Baca & Tulis JSONL
// ---------------------------------------------------------------------------

/**
 * Baca semua record dari file JSONL.
 *
 * @template T — Tipe record
 * @param {string} filePath — Path ke file JSONL
 * @returns {T[]} Array record
 */
function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const records: T[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as T);
      } catch {
        // skip baris corrupt
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Append satu record ke file JSONL.
 *
 * @param {string} filePath — Path ke file JSONL
 * @param {unknown} record — Record untuk disimpan
 * @returns {boolean} true jika berhasil
 */
function appendJsonl(filePath: string, record: unknown): boolean {
  try {
    appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fungsi Publik: Rekam
// ---------------------------------------------------------------------------

/**
 * Catat penyelesaian task ke dalam journal.
 * Mencatat outcome, pelajaran, pola, dan keputusan yang dibuat.
 *
 * @param {Omit<ExperienceEntry, "id" | "timestamp">} task — Data task completion tanpa id dan timestamp
 * @returns {ExperienceEntry} Entry yang sudah lengkap dengan ID dan timestamp
 *
 * @example
 * ```ts
 * recordCompletion({
 *   taskType: "implement",
 *   taskDesc: "Membuat REST API untuk user auth",
 *   outcome: "success",
 *   lessons: ["Refresh token perlu expiry lebih panjang"],
 *   patterns: ["auth-middleware-pattern"],
 *   decisions: [],
 *   tags: ["auth", "rest-api"]
 * });
 * ```
 */
export function recordCompletion(
  task: Omit<ExperienceEntry, "id" | "timestamp">,
): ExperienceEntry {
  const dir = ensureJournalDir();
  const entry: ExperienceEntry = {
    ...task,
    id: generateId("exp"),
    timestamp: new Date().toISOString(),
  };

  appendJsonl(join(dir, ENTRIES_FILE), entry);

  // Juga catat keputusan ke decisions file
  if (task.decisions && task.decisions.length > 0) {
    const decisionsFile = join(dir, DECISIONS_FILE);
    for (const decision of task.decisions) {
      appendJsonl(decisionsFile, decision);
    }
  }

  return entry;
}

/**
 * Catat kegagalan task ke dalam journal.
 * Berguna untuk quick logging dari catch block.
 *
 * @param {string} taskType — Tipe task (misal: "implement", "debug", "deploy")
 * @param {string} error — Pesan error atau deskripsi kegagalan
 * @param {string} context — Konteks di mana kegagalan terjadi
 * @returns {ExperienceEntry} Entry yang sudah dibuat
 *
 * @example
 * ```ts
 * try {
 *   await deploy();
 * } catch (err) {
 *   recordFailure("deploy", err.message, "Deployment ke staging");
 * }
 * ```
 */
export function recordFailure(
  taskType: string,
  error: string,
  context: string,
): ExperienceEntry {
  const dir = ensureJournalDir();
  const entry: ExperienceEntry = {
    id: generateId("exp"),
    timestamp: new Date().toISOString(),
    taskType,
    taskDesc: context,
    outcome: "failure",
    rootCause: error,
    lessons: [`Kegagalan di ${taskType}: ${error}`],
    patterns: [],
    decisions: [],
    tags: [taskType, "failure"],
  };

  appendJsonl(join(dir, ENTRIES_FILE), entry);

  return entry;
}

/**
 * Catat sebuah keputusan arsitektural atau teknis.
 * Keputusan akan tersimpan di decisions.jsonl dan bisa diquery ulang.
 *
 * @param {string} context — Konteks keputusan
 * @param {string[]} options — Opsi yang dipertimbangkan
 * @param {string} selected — Opsi yang dipilih
 * @param {string} rationale — Alasan pemilihan
 * @returns {DecisionRecord} Record keputusan yang sudah disimpan
 *
 * @example
 * ```ts
 * recordDecision(
 *   "Pilih library HTTP client",
 *   ["axios", "node-fetch", "undici"],
 *   "undici",
 *   "Built-in Node.js, performa lebih baik, bundle size lebih kecil"
 * );
 * ```
 */
export function recordDecision(
  context: string,
  options: string[],
  selected: string,
  rationale: string,
): DecisionRecord {
  const dir = ensureJournalDir();
  const record: DecisionRecord = {
    id: generateId("dec"),
    timestamp: new Date().toISOString(),
    context,
    options,
    selected,
    rationale,
  };

  appendJsonl(join(dir, DECISIONS_FILE), record);

  return record;
}

// ---------------------------------------------------------------------------
// Fungsi Publik: Query
// ---------------------------------------------------------------------------

/**
 * Cari pengalaman task terbaru, opsional filter berdasarkan tipe task.
 *
 * @param {string} [taskType] — Filter berdasarkan tipe task (opsional)
 * @param {number} [limit=10] — Jumlah maksimal hasil
 * @returns {ExperienceEntry[]} Array entry yang cocok, diurutkan dari terbaru
 *
 * @example
 * ```ts
 * // Cari 5 task debug terbaru
 * const debugTasks = queryRecent("debug", 5);
 *
 * // Cari semua task terbaru
 * const recent = queryRecent();
 * ```
 */
export function queryRecent(
  taskType?: string,
  limit: number = DEFAULT_QUERY_LIMIT,
): ExperienceEntry[] {
  const dir = ensureJournalDir();
  const allEntries = readJsonl<ExperienceEntry>(join(dir, ENTRIES_FILE));

  let filtered = allEntries;

  if (taskType) {
    const tt = taskType.toLowerCase();
    filtered = filtered.filter((e) => e.taskType.toLowerCase() === tt);
  }

  // Urutkan dari terbaru
  filtered.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

  return filtered.slice(0, limit);
}

/**
 * Cari keputusan masa lalu berdasarkan konteks.
 * Berguna saat menghadapi keputusan serupa dan ingin melihat
 * apa yang dipilih sebelumnya beserta alasannya.
 *
 * @param {string} [context] — Filter berdasarkan konteks (partial match, case-insensitive, opsional)
 * @returns {DecisionRecord[]} Array keputusan yang cocok, diurutkan dari terbaru
 *
 * @example
 * ```ts
 * // Cari semua keputusan tentang database
 * const dbDecisions = queryDecisions("database");
 * ```
 */
export function queryDecisions(context?: string): DecisionRecord[] {
  const dir = ensureJournalDir();
  const allDecisions = readJsonl<DecisionRecord>(join(dir, DECISIONS_FILE));

  let filtered = allDecisions;

  if (context) {
    const search = context.toLowerCase();
    filtered = filtered.filter(
      (d) =>
        d.context.toLowerCase().includes(search) ||
        d.selected.toLowerCase().includes(search) ||
        d.rationale.toLowerCase().includes(search) ||
        d.options.some((o) => o.toLowerCase().includes(search)),
    );
  }

  // Urutkan dari terbaru
  filtered.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

  return filtered;
}

// ---------------------------------------------------------------------------
// Fungsi Publik: Analisis
// ---------------------------------------------------------------------------

/**
 * Ekstrak pola dan tingkat keberhasilan dari journal.
 * Mengidentifikasi pola mana yang sering berhasil dan mana yang sering gagal.
 *
 * @returns {Array<{ pattern: string; frequency: number; avgSuccessRate: number }>}
 *   Array insight pola, diurutkan dari yang paling frekuen
 *
 * @example
 * ```ts
 * const insights = getInsights();
 * const terbaik = insights[0];
 * ```
 */
export function getInsights(): Array<{
  pattern: string;
  frequency: number;
  avgSuccessRate: number;
}> {
  const dir = ensureJournalDir();
  const allEntries = readJsonl<ExperienceEntry>(join(dir, ENTRIES_FILE));

  const patternMap = new Map<
    string,
    { total: number; successes: number; partials: number }
  >();

  for (const entry of allEntries) {
    for (const pattern of entry.patterns) {
      const key = pattern.toLowerCase().trim();
      if (!key) continue;

      if (!patternMap.has(key)) {
        patternMap.set(key, { total: 0, successes: 0, partials: 0 });
      }

      const stats = patternMap.get(key)!;
      stats.total += 1;

      if (entry.outcome === "success") stats.successes += 1;
      else if (entry.outcome === "partial") stats.partials += 1;
    }
  }

  const insights: Array<{
    pattern: string;
    frequency: number;
    avgSuccessRate: number;
  }> = [];

  for (const [pattern, stats] of patternMap) {
    const successRate =
      stats.total > 0
        ? (stats.successes + stats.partials * 0.5) / stats.total
        : 0;

    insights.push({
      pattern,
      frequency: stats.total,
      avgSuccessRate: Math.round(successRate * 100) / 100,
    });
  }

  // Urutkan berdasarkan frekuensi descending
  insights.sort((a, b) => b.frequency - a.frequency);

  return insights;
}

// ---------------------------------------------------------------------------
// Fungsi Publik: Statistik
// ---------------------------------------------------------------------------

/**
 * Dapatkan statistik ringkas dari journal.
 * Mencakup total entry, breakdown per outcome, pola teratas, dan keputusan terbaru.
 *
 * @returns {Stats} Objek statistik
 *
 * @example
 * ```ts
 * const stats = getStats();
 * console.log(`Total: ${stats.total}, Gagal: ${stats.byOutcome.failure}`);
 * ```
 */
export function getStats(): Stats {
  const dir = ensureJournalDir();
  const allEntries = readJsonl<ExperienceEntry>(join(dir, ENTRIES_FILE));
  const allDecisions = readJsonl<DecisionRecord>(join(dir, DECISIONS_FILE));

  const byOutcome: Record<ExperienceOutcome, number> = {
    success: 0,
    failure: 0,
    partial: 0,
  };

  for (const entry of allEntries) {
    if (byOutcome[entry.outcome] !== undefined) {
      byOutcome[entry.outcome] += 1;
    }
  }

  const topPatterns = getInsights().slice(0, 10);

  const recentDecisions = [...allDecisions]
    .sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp))
    .slice(0, 10);

  return {
    total: allEntries.length,
    byOutcome,
    topPatterns,
    recentDecisions,
  };
}

// ---------------------------------------------------------------------------
// Fungsi Publik: Format
// ---------------------------------------------------------------------------

/**
 * Format statistik journal menjadi string human-readable (Markdown).
 *
 * @param {Stats} stats — Objek statistik dari getStats()
 * @returns {string} String laporan format Markdown
 *
 * @example
 * ```ts
 * const stats = getStats();
 * console.log(formatReport(stats));
 * ```
 */
export function formatReport(stats: Stats): string {
  const lines: string[] = [];

  lines.push("# Laporan Experience Journal");
  lines.push("");
  lines.push(`**Total entries:** ${stats.total}`);
  lines.push("");

  // Breakdown per outcome
  lines.push("## Breakdown per Outcome");
  lines.push("| Outcome | Jumlah |");
  lines.push("|---------|--------|");
  const outcomeOrder: ExperienceOutcome[] = ["success", "partial", "failure"];
  for (const outcome of outcomeOrder) {
    const count = stats.byOutcome[outcome] ?? 0;
    const pct = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : "0.0";
    lines.push(`| ${outcome} | ${count} (${pct}%) |`);
  }
  lines.push("");

  // Top patterns
  if (stats.topPatterns.length > 0) {
    lines.push("## Pola Terpopuler");
    lines.push("| Pola | Frekuensi | Rata-rata Sukses |");
    lines.push("|------|-----------|------------------|");
    for (const p of stats.topPatterns) {
      const pct = (p.avgSuccessRate * 100).toFixed(0);
      lines.push(`| ${p.pattern} | ${p.frequency}x | ${pct}% |`);
    }
    lines.push("");
  }

  // Recent decisions
  if (stats.recentDecisions.length > 0) {
    lines.push("## Keputusan Terbaru");
    lines.push("| Konteks | Dipilih | Tanggal |");
    lines.push("|---------|---------|---------|");
    for (const d of stats.recentDecisions) {
      const date = new Date(d.timestamp).toLocaleDateString("id-ID", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const context = d.context.replace(/\|/g, "\\|");
      const selected = d.selected.replace(/\|/g, "\\|");
      lines.push(`| ${context} | ${selected} | ${date} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
