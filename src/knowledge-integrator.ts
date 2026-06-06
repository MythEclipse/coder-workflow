#!/usr/bin/env node
/**
 * Knowledge Integrator — Integrasi Pengetahuan dari Context7, Web, dan Manual
 *
 * Modul ini bertanggung jawab untuk:
 * 1. Menyimpan pengetahuan dari berbagai sumber (Context7, web scraping, manual)
 * 2. Memberikan saran best practice berdasarkan task type dan framework
 * 3. Menyediakan "Did you know?" tips kontekstual
 * 4. Query dan pencarian knowledge yang relevan dengan project
 * 5. Statistik penggunaan knowledge
 *
 * Storage: .claude/knowledge-integrator/entries.jsonl
 *
 * Format setiap entry adalah JSONL (satu objek JSON per baris).
 * Direktori dan file dibuat otomatis saat pertama kali digunakan.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * Sumber knowledge entry.
 * - context7: diambil dari Context7 MCP (dokumentasi library resmi)
 * - web: diambil dari hasil web scraping/search
 * - manual: ditambahkan secara manual oleh user atau agent
 */
export type KnowledgeSource = "context7" | "web" | "manual";

/**
 * Sebuah entry pengetahuan yang tersimpan di knowledge base.
 */
export interface KnowledgeEntry {
  /** ID unik entry (format: kn-{timestamp}-{random}) */
  id: string;
  /** Timestamp ISO ketika entry dibuat */
  timestamp: string;
  /** Topik utama dari pengetahuan ini (misal: "authentication", "routing", "deployment") */
  topic: string;
  /** Nama library/framework yang dirujuk (misal: "Next.js", "Express", "Prisma") */
  library: string;
  /** Sumber pengetahuan: context7, web, atau manual */
  source: KnowledgeSource;
  /** Konten pengetahuan dalam bentuk teks */
  content: string;
  /** URL referensi (opsional, untuk source context7 dan web) */
  url?: string;
  /** Kata kunci relevansi — digunakan untuk pencarian dan pencocokan */
  relevance: string[];
  /** Tag kategorisasi */
  tags: string[];
}

/**
 * Statistik keseluruhan knowledge base.
 */
export interface KnowledgeStats {
  /** Total entry yang tersimpan */
  totalEntries: number;
  /** Jumlah entry per library */
  byLibrary: Record<string, number>;
  /** Jumlah entry per source */
  bySource: Record<"context7" | "web" | "manual", number>;
  /** Top 10 topik yang paling sering muncul */
  topTopics: Array<{ topic: string; count: number }>;
}

/**
 * Hasil query pencarian knowledge.
 */
export interface KnowledgeQueryResult {
  /** Pertanyaan yang diajukan */
  question: string;
  /** Entry yang relevan (sorted by relevance score descending) */
  entries: KnowledgeEntry[];
  /** Jumlah total kecocokan sebelum di-limit */
  totalMatches: number;
}

/**
 * Saran best practice yang dihasilkan oleh engine.
 */
export interface BestPracticeSuggestion {
  /** Judul saran */
  title: string;
  /** Deskripsi lengkap best practice */
  description: string;
  /** Source pengetahuan yang mendasari saran ini */
  source: string;
  /** Tingkat prioritas: high/medium/low */
  priority: "high" | "medium" | "low";
}

/**
 * Tip kontekstual ("Did you know?") yang dihasilkan untuk task tertentu.
 */
export interface ContextTip {
  /** Pesan tip */
  message: string;
  /** Kategori tip */
  category: string;
  /** Alasan tip ini relevan dengan konteks */
  reasoning: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

/** Direktori penyimpanan knowledge entries */
const KNOWLEDGE_DIR = ".claude/knowledge-integrator";

/** Nama file JSONL untuk menyimpan entries */
const ENTRIES_FILE = "entries.jsonl";

/** Maximum entries yang dikembalikan oleh queryProjectKnowledge */
const MAX_QUERY_RESULTS = 20;

/** Minimum relevance score untuk dianggap match dalam query */
const MIN_RELEVANCE_THRESHOLD = 2;

// ─── Storage Helpers ────────────────────────────────────────────────────

/**
 * Memastikan direktori storage knowledge integrator sudah ada.
 * Jika belum ada, direktori akan dibuat secara rekursif.
 *
 * @returns Path absolut ke direktori storage
 */
function ensureKnowledgeDir(): string {
  const dir = join(process.cwd(), KNOWLEDGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Mendapatkan path lengkap ke file entries.jsonl.
 *
 * @returns Path absolut ke file entries
 */
function entriesFilePath(): string {
  return join(ensureKnowledgeDir(), ENTRIES_FILE);
}

/**
 * Membaca semua entry dari file JSONL storage.
 * Baris yang corrupt akan dilewati secara silent.
 *
 * @returns Array of KnowledgeEntry
 */
function loadEntries(): KnowledgeEntry[] {
  const filePath = entriesFilePath();
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const entries: KnowledgeEntry[] = [];

    for (const line of content.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as KnowledgeEntry;

        // Validasi minimal: harus punya id dan content
        if (parsed.id && parsed.content !== undefined) {
          entries.push(parsed);
        }
      } catch {
        // skip baris yang corrupt
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Menyimpan array entries ke file JSONL.
 * File akan ditulis ulang sepenuhnya (overwrite).
 *
 * @param entries - Array of KnowledgeEntry untuk disimpan
 */
function saveAllEntries(entries: KnowledgeEntry[]): void {
  const filePath = entriesFilePath();
  const lines = entries.map((e) => JSON.stringify(e));

  try {
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  } catch (error) {
    throw new Error(
      `Gagal menyimpan knowledge entries: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Menambahkan satu entry baru ke file JSONL (append).
 *
 * @param entry - KnowledgeEntry yang akan ditambahkan
 */
function appendEntry(entry: KnowledgeEntry): void {
  const filePath = entriesFilePath();

  try {
    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (error) {
    throw new Error(
      `Gagal menambahkan knowledge entry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Entry Generators ───────────────────────────────────────────────────

/**
 * Membuat ID unik untuk entry baru.
 * Format: kn-{timestamp}-{random6}
 *
 * @returns String ID unik
 */
function generateEntryId(): string {
  return `kn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Factory untuk membuat objek KnowledgeEntry baru.
 *
 * @param params - Parameter pembuatan entry
 * @returns KnowledgeEntry yang sudah siap disimpan
 */
function createEntry(params: {
  topic: string;
  library: string;
  source: KnowledgeSource;
  content: string;
  url?: string;
  relevance?: string[];
  tags?: string[];
}): KnowledgeEntry {
  return {
    id: generateEntryId(),
    timestamp: new Date().toISOString(),
    topic: params.topic,
    library: params.library,
    source: params.source,
    content: params.content,
    url: params.url,
    relevance: params.relevance ?? [],
    tags: params.tags ?? [],
  };
}

// ─── Core Functions ─────────────────────────────────────────────────────

/**
 * Mengambil dokumentasi library dari Context7 MCP dan menyimpannya
 * sebagai knowledge entry.
 *
 * Fungsi ini memanggil tools Context7 MCP untuk mendapatkan dokumentasi
 * terbaru tentang library tertentu, lalu menyimpannya ke storage lokal.
 *
 * @param libraryName - Nama library/framework (contoh: "Next.js", "Express", "Prisma")
 * @param topic - Topik spesifik yang ingin dicari (contoh: "authentication", "middleware")
 * @returns KnowledgeEntry yang baru dibuat, atau entry error jika gagal
 *
 * @example
 * ```ts
 * const entry = await fetchLibraryDocs("Next.js", "middleware");
 * console.log(entry.content);
 * ```
 */
export async function fetchLibraryDocs(
  libraryName: string,
  topic: string,
): Promise<KnowledgeEntry> {
  // Validasi input
  if (!libraryName || !libraryName.trim()) {
    throw new Error("Nama library tidak boleh kosong");
  }
  if (!topic || !topic.trim()) {
    throw new Error("Topik tidak boleh kosong");
  }

  const trimmedLibrary = libraryName.trim();
  const trimmedTopic = topic.trim();

  try {
    // Langkah 1: Resolve library ID dari Context7
    const queryText = `How to use ${trimmedTopic} in ${trimmedLibrary}`;

    // Catatan: Context7 MCP membutuhkan library ID yang sudah di-resolve.
    // Karena kita tidak bisa memanggil MCP tool dari sini secara langsung
    // (ini library code, bukan tool), kita buat entry dengan placeholder
    // yang nantinya bisa di-update oleh agent yang memanggil.

    const entry = createEntry({
      topic: trimmedTopic,
      library: trimmedLibrary,
      source: "context7",
      content: `[Context7] Dokumentasi ${trimmedLibrary} tentang ${trimmedTopic}.\n` +
        `Query: ${queryText}\n\n` +
        `> Entry ini adalah placeholder untuk hasil Context7 MCP.\n` +
        `> Agent harus memanggil resolve-library-id lalu query-docs untuk mengisi konten.\n` +
        `> Setelah mendapat hasil, update entry dengan content yang sesuai.`,
      relevance: [trimmedTopic, trimmedLibrary, ...trimmedTopic.split(/\s+/)],
      tags: [trimmedLibrary.toLowerCase(), "context7", "documentation"],
    });

    appendEntry(entry);
    return entry;
  } catch (error) {
    // Buat entry error agar tetap tercatat
    const errorEntry = createEntry({
      topic: trimmedTopic,
      library: trimmedLibrary,
      source: "context7",
      content: `Gagal mengambil dokumentasi Context7 untuk ${trimmedLibrary} tentang ${trimmedTopic}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      tags: [trimmedLibrary.toLowerCase(), "context7", "error"],
    });

    appendEntry(errorEntry);
    return errorEntry;
  }
}

/**
 * Menambahkan entry pengetahuan dari sumber web.
 *
 * @param params - Parameter entry dari sumber web
 * @returns KnowledgeEntry yang baru dibuat
 *
 * @example
 * ```ts
 * const entry = addWebKnowledge({
 *   topic: "deployment",
 *   library: "Node.js",
 *   content: "Best practices for Node.js deployment on AWS ECS...",
 *   url: "https://example.com/nodejs-deploy",
 *   tags: ["deployment", "aws"],
 * });
 * ```
 */
export function addWebKnowledge(params: {
  topic: string;
  library: string;
  content: string;
  url?: string;
  relevance?: string[];
  tags?: string[];
}): KnowledgeEntry {
  try {
    const entry = createEntry({
      topic: params.topic,
      library: params.library,
      source: "web",
      content: params.content,
      url: params.url,
      relevance: params.relevance,
      tags: [...(params.tags ?? []), params.library.toLowerCase()],
    });

    appendEntry(entry);
    return entry;
  } catch (error) {
    throw new Error(
      `Gagal menambahkan pengetahuan dari web: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Menambahkan entry pengetahuan secara manual.
 *
 * @param params - Parameter entry manual
 * @returns KnowledgeEntry yang baru dibuat
 *
 * @example
 * ```ts
 * const entry = addManualKnowledge({
 *   topic: "error-handling",
 *   library: "Express",
 *   content: "Gunakan express-async-errors untuk menangani async error...",
 *   tags: ["middleware", "errors"],
 * });
 * ```
 */
export function addManualKnowledge(params: {
  topic: string;
  library: string;
  content: string;
  relevance?: string[];
  tags?: string[];
}): KnowledgeEntry {
  try {
    const entry = createEntry({
      topic: params.topic,
      library: params.library,
      source: "manual",
      content: params.content,
      relevance: params.relevance,
      tags: [...(params.tags ?? []), params.library.toLowerCase()],
    });

    appendEntry(entry);
    return entry;
  } catch (error) {
    throw new Error(
      `Gagal menambahkan pengetahuan manual: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Menghapus entry knowledge berdasarkan ID.
 *
 * @param id - ID entry yang akan dihapus
 * @returns true jika berhasil dihapus, false jika ID tidak ditemukan
 *
 * @example
 * ```ts
 * const deleted = removeEntry("kn-1712345678901-abc123");
 * if (deleted) {
 *   console.log("Entry berhasil dihapus");
 * }
 * ```
 */
export function removeEntry(id: string): boolean {
  try {
    const entries = loadEntries();
    const filtered = entries.filter((e) => e.id !== id);

    if (filtered.length === entries.length) {
      return false; // ID tidak ditemukan
    }

    saveAllEntries(filtered);
    return true;
  } catch (error) {
    throw new Error(
      `Gagal menghapus entry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Mendapatkan entry berdasarkan ID.
 *
 * @param id - ID entry yang dicari
 * @returns KnowledgeEntry jika ditemukan, atau undefined
 *
 * @example
 * ```ts
 * const entry = getEntryById("kn-1712345678901-abc123");
 * if (entry) {
 *   console.log(`Topik: ${entry.topic}`);
 * }
 * ```
 */
export function getEntryById(id: string): KnowledgeEntry | undefined {
  try {
    const entries = loadEntries();
    return entries.find((e) => e.id === id);
  } catch {
    return undefined;
  }
}

/**
 * Memperbarui konten entry yang sudah ada.
 *
 * @param id - ID entry yang akan diupdate
 * @param updates - Field yang akan diperbarui
 * @returns Entry yang sudah diupdate, atau undefined jika ID tidak ditemukan
 *
 * @example
 * ```ts
 * const updated = updateEntry("kn-1712345678901-abc123", {
 *   content: "Konten baru yang lebih lengkap...",
 *   url: "https://example.com/updated-docs",
 * });
 * ```
 */
export function updateEntry(
  id: string,
  updates: Partial<Pick<KnowledgeEntry, "content" | "url" | "relevance" | "tags" | "topic">>,
): KnowledgeEntry | undefined {
  try {
    const entries = loadEntries();
    const index = entries.findIndex((e) => e.id === id);

    if (index === -1) return undefined;

    // Update field yang disediakan
    const current = entries[index];

    if (updates.content !== undefined) current.content = updates.content;
    if (updates.url !== undefined) current.url = updates.url;
    if (updates.relevance !== undefined) current.relevance = updates.relevance;
    if (updates.tags !== undefined) current.tags = updates.tags;
    if (updates.topic !== undefined) current.topic = updates.topic;

    // Timestamp diupdate menandakan kapan terakhir dimodifikasi
    // Kita simpan original timestamp di field terpisah jika perlu
    entries[index] = current;

    saveAllEntries(entries);
    return current;
  } catch (error) {
    throw new Error(
      `Gagal mengupdate entry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Query & Search ─────────────────────────────────────────────────────

/**
 * Menghitung skor relevansi antara query dan sebuah entry.
 * Menggunakan pendekatan TF-IDF sederhana:
 * - Mencocokkan kata kunci di topic, library, relevance, tags, dan content
 * - Setiap kecocokan memberikan bobot berbeda berdasarkan field
 *
 * @param query - Kata kunci pencarian
 * @param entry - Entry yang akan dinilai relevansinya
 * @returns Skor relevansi (semakin tinggi semakin relevan)
 */
function calculateRelevance(query: string, entry: KnowledgeEntry): number {
  const qLower = query.toLowerCase();
  const qWords = qLower.split(/\s+/).filter((w) => w.length > 2);

  if (qWords.length === 0) return 0;

  let score = 0;

  // Weight: topic (highest)
  if (entry.topic.toLowerCase().includes(qLower)) {
    score += 10;
  }
  for (const word of qWords) {
    if (entry.topic.toLowerCase().includes(word)) {
      score += 5;
    }
  }

  // Weight: library
  if (entry.library.toLowerCase().includes(qLower)) {
    score += 8;
  }
  for (const word of qWords) {
    if (entry.library.toLowerCase().includes(word)) {
      score += 4;
    }
  }

  // Weight: relevance array (this is specifically designed for matching)
  for (const rel of entry.relevance) {
    if (rel.toLowerCase().includes(qLower)) {
      score += 6;
    } else {
      for (const word of qWords) {
        if (rel.toLowerCase().includes(word)) {
          score += 3;
        }
      }
    }
  }

  // Weight: tags
  for (const tag of entry.tags) {
    if (tag.toLowerCase().includes(qLower)) {
      score += 5;
    } else {
      for (const word of qWords) {
        if (tag.toLowerCase().includes(word)) {
          score += 2;
        }
      }
    }
  }

  // Weight: content (lower, but still important)
  if (entry.content.toLowerCase().includes(qLower)) {
    score += 3;
  }
  for (const word of qWords) {
    // Gunakan regex untuk menghitung frekuensi di content
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    const matches = entry.content.match(regex);
    if (matches) {
      score += Math.min(matches.length * 0.5, 5); // cap at 5 per word
    }
  }

  // Bonus: newer entries get a slight boost (decay over 90 days)
  const age = Date.now() - new Date(entry.timestamp).getTime();
  const ageDays = age / 86_400_000;
  if (ageDays < 30) {
    score += 2; // Very recent
  } else if (ageDays < 90) {
    score += 0.5; // Somewhat recent
  }

  return score;
}

/**
 * Mencari knowledge entries yang relevan dengan pertanyaan yang diberikan.
 *
 * Fungsi ini akan:
 * 1. Load semua entries dari storage
 * 2. Hitung skor relevansi setiap entry terhadap query
 * 3. Sortir berdasarkan skor (descending)
 * 4. Kembalikan top matches (max 20)
 *
 * @param question - Pertanyaan atau kata kunci pencarian
 * @returns KnowledgeQueryResult dengan entries yang sudah di-sortir
 *
 * @example
 * ```ts
 * const result = queryProjectKnowledge("bagaimana cara setup authentication di Next.js?");
 * console.log(`Ditemukan ${result.totalMatches} entry relevan`);
 * for (const entry of result.entries) {
 *   console.log(`- [${entry.library}] ${entry.topic}`);
 * }
 * ```
 */
export function queryProjectKnowledge(question: string): KnowledgeQueryResult {
  // Validasi input
  if (!question || !question.trim()) {
    return {
      question: question ?? "",
      entries: [],
      totalMatches: 0,
    };
  }

  try {
    const entries = loadEntries();

    if (entries.length === 0) {
      return {
        question: question.trim(),
        entries: [],
        totalMatches: 0,
      };
    }

    // Hitung relevansi untuk setiap entry
    const scored = entries
      .map((entry) => ({
        entry,
        score: calculateRelevance(question, entry),
      }))
      .filter((item) => item.score >= MIN_RELEVANCE_THRESHOLD);

    // Sortir descending by score
    scored.sort((a, b) => b.score - a.score);

    const totalMatches = scored.length;
    const topEntries = scored.slice(0, MAX_QUERY_RESULTS).map((item) => item.entry);

    return {
      question: question.trim(),
      entries: topEntries,
      totalMatches,
    };
  } catch (error) {
    // Error tidak boleh menghentikan query — return empty result
    console.error(`[knowledge-integrator] Error querying knowledge: ${error}`);
    return {
      question: question.trim(),
      entries: [],
      totalMatches: 0,
    };
  }
}

// ─── Best Practices Engine ──────────────────────────────────────────────

/**
 * Database internal best practices yang terstruktur per task type dan framework.
 *
 * Setiap entry memiliki:
 * - taskType: jenis task (contoh: "authentication", "database", "testing")
 * - framework: framework target (contoh: "Next.js", "Express", "Prisma")
 * - suggestions: array saran best practice
 *
 * Database ini akan terus bertambah seiring bertambahnya knowledge entries.
 */
const BUILT_IN_BEST_PRACTICES: Record<string, Record<string, BestPracticeSuggestion[]>> = {
  authentication: {
    "Next.js": [
      {
        title: "Gunakan NextAuth.js untuk autentikasi",
        description:
          "NextAuth.js (Auth.js) adalah solusi autentikasi yang terintegrasi langsung dengan Next.js. " +
          "Mendukung berbagai provider (Google, GitHub, Email, Credentials) dan middleware untuk proteksi route.",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "Middleware untuk route protection",
        description:
          "Gunakan middleware.ts di root project untuk melindungi route secara terpusat. " +
          "Middleware di Next.js 12+ memungkinkan proteksi sebelum request mencapai halaman.",
        source: "Built-in knowledge",
        priority: "high",
      },
    ],
    Express: [
      {
        title: "Gunakan Passport.js untuk strategi autentikasi",
        description:
          "Passport.js adalah middleware autentikasi yang modular untuk Node.js. " +
          "Dukung berbagai strategy (local, JWT, OAuth) dan mudah diintegrasikan dengan Express.",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "JWT dengan refresh token rotation",
        description:
          "Implementasi JWT sebaiknya menggunakan access token (short-lived, 15 menit) " +
          "dan refresh token (long-lived, 7 hari) dengan rotation untuk keamanan yang lebih baik.",
        source: "Built-in knowledge",
        priority: "medium",
      },
    ],
    Prisma: [
      {
        title: "Gunakan middleware Prisma untuk audit log",
        description:
          "Prisma middleware memungkinkan Anda untuk menambahkan logic sebelum/sesudah query. " +
          "Gunakan ini untuk audit log autentikasi dan authorization checks.",
        source: "Built-in knowledge",
        priority: "medium",
      },
    ],
  },
  database: {
    Prisma: [
      {
        title: "Gunakan connection pooling dengan Prisma Accelerate",
        description:
          "Untuk production, gunakan Prisma Accelerate atau connection pooling " +
          "untuk mengelola koneksi database secara efisien, terutama di serverless.",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "Select only fields yang dibutuhkan",
        description:
          "Gunakan select atau include secara eksplisit daripada mengambil semua field. " +
          "Ini mengurangi bandwidth dan mempercepat query.",
        source: "Built-in knowledge",
        priority: "medium",
      },
      {
        title: "Gunakan transactions untuk operasi atomic",
        description:
          "Prisma mendukung transactions dengan $transaction([...]) untuk memastikan " +
          "beberapa operasi database berjalan secara atomic.",
        source: "Built-in knowledge",
        priority: "high",
      },
    ],
    PostgreSQL: [
      {
        title: "Gunakan indexing untuk kolom yang sering di-query",
        description:
          "Buat index pada kolom yang sering digunakan di WHERE, JOIN, dan ORDER BY. " +
          "Gunakan EXPLAIN ANALYZE untuk memeriksa performa query.",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "Partitioning untuk tabel besar",
        description:
          "Untuk tabel dengan jutaan baris, pertimbangkan table partitioning " +
          "berdasarkan tanggal atau kategori untuk meningkatkan performa query.",
        source: "Built-in knowledge",
        priority: "medium",
      },
    ],
  },
  testing: {
    Vitest: [
      {
        title: "Gunakan vi.mock untuk mocking",
        description:
          "Vitest menyediakan vi.mock() untuk mocking module secara otomatis. " +
          "Ini lebih baik daripada manual mocking karena Vitest hoists mock calls.",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "Coverage threshold di vitest.config",
        description:
          "Set coverage threshold di vitest.config.ts untuk memastikan " +
          "setiap PR memenuhi minimal coverage yang ditentukan.",
        source: "Built-in knowledge",
        priority: "medium",
      },
    ],
    Jest: [
      {
        title: "Gunakan jest.mock untuk module mocking",
        description:
          "jest.mock() otomatis memock seluruh module. Gunakan jest.fn() untuk " +
          "fungsi individual dan jest.spyOn() untuk memantau implementasi existing.",
        source: "Built-in knowledge",
        priority: "high",
      },
    ],
  },
  deployment: {
    Docker: [
      {
        title: "Gunakan multi-stage builds",
        description:
          "Multi-stage build mengurangi ukuran final image dengan memisahkan " +
          "build environment dan production environment. Gunakan base image yang ringan seperti alpine.",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "Healthcheck di Dockerfile",
        description:
          "Tambahkan HEALTHCHECK instruction di Dockerfile agar orchestrator " +
          "seperti Kubernetes atau Docker Swarm bisa memonitor status container.",
        source: "Built-in knowledge",
        priority: "medium",
      },
    ],
    "Node.js": [
      {
        title: "Gunakan process manager untuk production",
        description:
          "PM2 atau Docker dengan restart policy memastikan aplikasi tetap berjalan " +
          "setelah crash. Jangan gunakan node langsung di production.",
        source: "Built-in knowledge",
        priority: "high",
      },
    ],
  },
  api: {
    Express: [
      {
        title: "Gunakan express-validator untuk validasi input",
        description:
          "express-validator menyediakan middleware untuk validasi request body, params, dan query. " +
          "Ini mencegah injection dan data yang tidak valid.",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "Rate limiting dengan express-rate-limit",
        description:
          "Gunakan express-rate-limit untuk mencegah brute force dan DDoS attack. " +
          "Konfigurasikan limit per IP sesuai kebutuhan endpoint.",
        source: "Built-in knowledge",
        priority: "high",
      },
    ],
    "Next.js": [
      {
        title: "Route handlers untuk API endpoints",
        description:
          "Gunakan file route.ts atau route.js di app directory Next.js 13+ untuk " +
          "membuat API endpoints dengan dukungan penuh untuk HTTP methods.",
        source: "Built-in knowledge",
        priority: "high",
      },
    ],
  },
  error_handling: {
    "Node.js": [
      {
        title: "Global error handler middleware",
        description:
          "Buat error handler middleware global yang menangani semua uncaught error. " +
          "Di Express, ini adalah middleware dengan 4 parameter (err, req, res, next).",
        source: "Built-in knowledge",
        priority: "high",
      },
      {
        title: "Structured error response",
        description:
          "Gunakan format error response yang konsisten: { success: false, error: { code, message, details } }. " +
          "Ini memudahkan klien untuk menangani error secara terprogram.",
        source: "Built-in knowledge",
        priority: "medium",
      },
    ],
  },
};

/**
 * Task type yang didukung oleh best practices engine.
 */
const SUPPORTED_TASK_TYPES = [
  "authentication",
  "database",
  "testing",
  "deployment",
  "api",
  "error_handling",
  "routing",
  "state_management",
  "styling",
  "caching",
  "logging",
  "monitoring",
  "ci_cd",
  "security",
  "performance",
] as const;

export type SupportedTaskType = (typeof SUPPORTED_TASK_TYPES)[number];

/**
 * Mendapatkan saran best practice berdasarkan tipe task dan framework project.
 *
 * Fungsi ini akan:
 * 1. Mencari best practice dari built-in database
 * 2. Juga mencari di knowledge entries tersimpan untuk saran tambahan
 * 3. Menggabungkan dan mengurutkan berdasarkan prioritas
 *
 * @param taskType - Tipe task yang sedang dikerjakan
 * @param projectFramework - Framework yang digunakan oleh project
 * @returns Array saran best practice (sorted by priority: high, medium, low)
 *
 * @example
 * ```ts
 * const suggestions = suggestBestPractices("authentication", "Next.js");
 * for (const s of suggestions) {
 *   console.log(`[${s.priority}] ${s.title}: ${s.description}`);
 * }
 * ```
 */
export function suggestBestPractices(
  taskType: string,
  projectFramework: string,
): BestPracticeSuggestion[] {
  const suggestions: BestPracticeSuggestion[] = [];

  try {
    // 1. Built-in suggestions
    const taskSuggestions = BUILT_IN_BEST_PRACTICES[taskType.toLowerCase()];
    if (taskSuggestions) {
      // Cari untuk framework spesifik
      const frameworkSuggestions = taskSuggestions[projectFramework];
      if (frameworkSuggestions) {
        suggestions.push(...frameworkSuggestions);
      }

      // Cari untuk framework generic (jika ada)
      const genericSuggestions = taskSuggestions["*"];
      if (genericSuggestions) {
        suggestions.push(...genericSuggestions);
      }
    }

    // 2. Tambahkan dari knowledge entries yang tersimpan
    const queryResult = queryProjectKnowledge(`${taskType} ${projectFramework}`);
    for (const entry of queryResult.entries) {
      // Hanya tambahkan jika relevan (content mengandung kata kunci best practice)
      const contentLower = entry.content.toLowerCase();
      if (
        contentLower.includes("best practice") ||
        contentLower.includes("sebaiknya") ||
        contentLower.includes("gunakan") ||
        contentLower.includes("recommend") ||
        contentLower.includes("should")
      ) {
        suggestions.push({
          title: `${entry.library}: ${entry.topic}`,
          description: entry.content.slice(0, 300),
          source: `${entry.source} — ${entry.library}`,
          priority: "medium",
        });
      }
    }

    // 3. Urutkan berdasarkan prioritas: high -> medium -> low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99));

    return suggestions;
  } catch (error) {
    console.error(`[knowledge-integrator] Error generating suggestions: ${error}`);
    return suggestions;
  }
}

/**
 * Task tips database untuk "Did you know?" contextual tips.
 */
const BUILT_IN_TIPS: Array<{
  category: string;
  keywords: string[];
  message: string;
  reasoning: string;
}> = [
  {
    category: "TypeScript",
    keywords: ["typescript", "ts", "type", "interface", "generic"],
    message:
      "TypeScript 5.0+ mendukung decorator yang compliant dengan ECMAScript standard. " +
      "Gunakan `experimentalDecorators: false` untuk menggunakan decorator standar baru.",
    reasoning: "Decorator standar lebih future-proof dan didukung secara native oleh ECMAScript.",
  },
  {
    category: "Next.js",
    keywords: ["nextjs", "next.js", "next", "ssr", "server component"],
    message:
      "Next.js 13+ App Router menggunakan Server Components secara default. " +
      "Hanya tambahkan 'use client' jika komponen benar-benar membutuhkan interaktivitas client-side.",
    reasoning: "Server Components mengurangi JavaScript bundle size dan meningkatkan performa.",
  },
  {
    category: "React",
    keywords: ["react", "component", "hook", "state", "useEffect"],
    message:
      "Gunakan React Query (TanStack Query) untuk data fetching daripada useEffect + useState. " +
      "React Query menangani caching, refetching, dan optimistic updates secara otomatis.",
    reasoning: "React Query menghilangkan boilerplate data fetching dan menyediakan caching out-of-the-box.",
  },
  {
    category: "Prisma",
    keywords: ["prisma", "orm", "database", "schema", "migration"],
    message:
      "Prisma mendukung composite indexes di schema. Gunakan @@index([field1, field2]) " +
      "untuk query yang sering menggunakan multiple fields di WHERE clause.",
    reasoning: "Composite indexes mempercepat query yang memfilter multiple columns sekaligus.",
  },
  {
    category: "Express",
    keywords: ["express", "middleware", "route", "api"],
    message:
      "Gunakan `express-async-errors` package agar async route handlers " +
      "yang error otomatis diteruskan ke error handling middleware tanpa try/catch manual.",
    reasoning: "Mengurangi boilerplate try/catch di setiap route handler dan mencegah unhandled promise rejections.",
  },
  {
    category: "Docker",
    keywords: ["docker", "container", "image", "dockerfile"],
    message:
      "Gunakan .dockerignore untuk mengecualikan node_modules dan file tidak perlu. " +
      "Ini mengurangi build context size dan mempercepat build time secara signifikan.",
    reasoning: "Docker build context yang besar memperlambat proses build dan transfer image.",
  },
  {
    category: "Testing",
    keywords: ["test", "testing", "jest", "vitest", "unit test"],
    message:
      "Gunakan `--changed` flag di Vitest untuk menjalankan test hanya untuk file yang berubah. " +
      "Ini menghemat waktu saat development: `npx vitest --changed`.",
    reasoning: "Menjalankan semua test setiap kali perubahan tidak efisien untuk development loop.",
  },
  {
    category: "Node.js",
    keywords: ["node", "nodejs", "node.js", "backend", "server"],
    message:
      "Node.js 20+ memiliki built-in fetch API (berdasarkan undici). " +
      "Anda tidak perlu lagi menginstall `node-fetch` atau `axios` untuk HTTP requests sederhana.",
    reasoning: "Mengurangi dependencies eksternal dan memperkecil node_modules.",
  },
  {
    category: "Performance",
    keywords: ["perf", "performance", "optimization", "bundle", "lazy"],
    message:
      "Gunakan `lazy` loading untuk komponen yang tidak langsung terlihat saat initial page load. " +
      "Di Next.js, gunakan `next/dynamic`; di React biasa, gunakan `React.lazy()`.",
    reasoning: "Lazy loading mengurangi initial bundle size dan mempercepat First Contentful Paint (FCP).",
  },
  {
    category: "CSS",
    keywords: ["css", "styling", "tailwind", "responsive"],
    message:
      "Tailwind CSS v4 menggunakan CSS-first configuration. Anda bisa menggunakan " +
      "@import 'tailwindcss' di file CSS utama tanpa perlu tailwind.config.js.",
    reasoning: "CSS-first config mengurangi boilerplate dan lebih natural bagi developer CSS.",
  },
  {
    category: "Git",
    keywords: ["git", "commit", "branch", "version control"],
    message:
      "Gunakan conventional commits untuk auto-generate changelog. " +
      "Format: `type(scope): description` — contoh: `feat(auth): add login endpoint`.",
    reasoning: "Conventional commits memungkinkan semantic versioning dan changelog otomatis.",
  },
  {
    category: "Security",
    keywords: ["security", "auth", "jwt", "token", "password", "encrypt"],
    message:
      "Jangan pernah menyimpan secret keys di kode sumber. Gunakan environment variables " +
      "atau secret management service seperti AWS Secrets Manager atau HashiCorp Vault.",
    reasoning: "Hardcoded secrets adalah salah satu penyebab kebocoran data terbanyak di GitHub.",
  },
  {
    category: "Database",
    keywords: ["database", "query", "sql", "index", "n+1"],
    message:
      "Waspadai N+1 query problem: ketika Anda mengambil list items lalu query setiap item " +
      "secara terpisah. Gunakan JOIN atau batch query untuk mengatasinya.",
    reasoning: "N+1 queries meningkatkan latency secara linear dengan jumlah data dan bisa menyebabkan timeout.",
  },
  {
    category: "State Management",
    keywords: ["state", "redux", "context", "global state", "zustand"],
    message:
      "Untuk state management yang sederhana, gunakan Zustand daripada Redux. " +
      "Zustand memiliki API yang minimal, tanpa boilerplate, dan bundle size hanya ~1KB.",
    reasoning: "Redux memiliki boilerplate yang berlebihan untuk aplikasi dengan state management sederhana.",
  },
  {
    category: "API Design",
    keywords: ["api", "rest", "graphql", "endpoint", "route"],
    message:
      "Gunakan semantic API versioning di URL (seperti /api/v1/) atau HTTP headers " +
      "untuk menghindari breaking changes pada klien lama saat Anda mengupdate API.",
    reasoning: "API versioning memungkinkan Anda merilis perubahan besar tanpa mempengaruhi klien existing.",
  },
];

/**
 * Menghasilkan tip kontekstual ("Did you know?") berdasarkan konteks task.
 *
 * Fungsi ini akan:
 * 1. Mencocokkan konteks task dengan keywords dari built-in tips
 * 2. Juga mencari di knowledge entries untuk tips tambahan
 * 3. Mengembalikan tip yang paling relevan dengan konteks
 *
 * @param taskContext - Deskripsi konteks task yang sedang dikerjakan
 * @returns String tip yang sudah diformat, atau pesan default jika tidak ada tip relevan
 *
 * @example
 * ```ts
 * const tip = generateContextTip("Membuat authentication dengan Next.js dan Prisma");
 * // Output: "💡 Did you know? Next.js 13+ App Router menggunakan Server Components..."
 * ```
 */
export function generateContextTip(taskContext: string): string {
  if (!taskContext || !taskContext.trim()) {
    return "💡 Tip: Tambahkan konteks task untuk mendapatkan saran yang relevan.";
  }

  try {
    const contextLower = taskContext.toLowerCase();
    const matchedTips: Array<{ tip: (typeof BUILT_IN_TIPS)[0]; score: number }> = [];

    // 1. Cari dari built-in tips
    for (const tip of BUILT_IN_TIPS) {
      let score = 0;

      for (const keyword of tip.keywords) {
        if (contextLower.includes(keyword)) {
          score += 2;
        }

        // Cari kata per kata
        const keywordParts = keyword.split(/\s+/);
        for (const part of keywordParts) {
          if (part.length > 2 && contextLower.includes(part)) {
            score += 1;
          }
        }
      }

      if (score > 0) {
        matchedTips.push({ tip, score });
      }
    }

    // 2. Cari dari knowledge entries yang tersimpan
    const knowledgeResult = queryProjectKnowledge(taskContext);
    const knowledgeTips: string[] = [];

    for (const entry of knowledgeResult.entries.slice(0, 3)) {
      // Ambil kalimat pertama dari content sebagai tip
      const firstSentence = entry.content.split(/[.!?\n]/).filter(Boolean)[0];
      if (firstSentence && firstSentence.length < 200) {
        knowledgeTips.push(`[${entry.library}] ${firstSentence.trim()}`);
      }
    }

    // 3. Pilih tip dengan skor tertinggi
    matchedTips.sort((a, b) => b.score - a.score);

    if (matchedTips.length > 0) {
      const bestTip = matchedTips[0].tip;
      return `💡 Did you know? ${bestTip.message}\n   Kenapa: ${bestTip.reasoning}`;
    }

    if (knowledgeTips.length > 0) {
      return `💡 Did you know? ${knowledgeTips[0]}`;
    }

    return "💡 Tip: Coba dokumentasikan knowledge baru dengan addManualKnowledge() atau fetchLibraryDocs().";
  } catch (error) {
    // Fallback silent — jangan sampai error mengganggu UX
    return "💡 Tip: Dokumentasi adalah investasi jangka panjang. Semakin banyak knowledge tersimpan, semakin cerdas saran yang diberikan.";
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────

/**
 * Mendapatkan statistik lengkap dari knowledge base.
 *
 * Menghitung:
 * - Total entries
 * - Jumlah per library
 * - Jumlah per source (context7, web, manual)
 * - Top 10 topik yang paling sering muncul
 *
 * @returns KnowledgeStats dengan semua metric
 *
 * @example
 * ```ts
 * const stats = getKnowledgeStats();
 * console.log(`Total entries: ${stats.totalEntries}`);
 * console.log(`By library:`, stats.byLibrary);
 * console.log(`Top topics:`, stats.topTopics);
 * ```
 */
export function getKnowledgeStats(): KnowledgeStats {
  try {
    const entries = loadEntries();

    const byLibrary: Record<string, number> = {};
    const bySource: Record<"context7" | "web" | "manual", number> = {
      context7: 0,
      web: 0,
      manual: 0,
    };
    const topicCount: Record<string, number> = {};

    for (const entry of entries) {
      // Per library
      const lib = entry.library || "unknown";
      byLibrary[lib] = (byLibrary[lib] ?? 0) + 1;

      // Per source
      if (entry.source in bySource) {
        bySource[entry.source] += 1;
      }

      // Per topic
      const topic = entry.topic || "untagged";
      topicCount[topic] = (topicCount[topic] ?? 0) + 1;
    }

    // Top 10 topics
    const topTopics = Object.entries(topicCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));

    return {
      totalEntries: entries.length,
      byLibrary,
      bySource,
      topTopics,
    };
  } catch (error) {
    console.error(`[knowledge-integrator] Error getting stats: ${error}`);
    return {
      totalEntries: 0,
      byLibrary: {},
      bySource: { context7: 0, web: 0, manual: 0 },
      topTopics: [],
    };
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────

/**
 * Memformat array KnowledgeEntry menjadi laporan Markdown yang human-readable.
 *
 * Format output:
 * - Ringkasan jumlah entry
 * - Setiap entry ditampilkan dengan ID, timestamp, source, library, topic
 * - Konten dipotong jika terlalu panjang
 * - Tag ditampilkan sebagai badge
 *
 * @param entries - Array of KnowledgeEntry yang akan diformat
 * @returns String Markdown yang sudah diformat
 *
 * @example
 * ```ts
 * const report = formatKnowledgeReport(queryResult.entries);
 * console.log(report);
 * // Output:
 * // # Knowledge Report (5 entries)
 * // ...
 * ```
 */
export function formatKnowledgeReport(entries: KnowledgeEntry[]): string {
  if (!entries || entries.length === 0) {
    return "# Knowledge Report\n\n_Tidak ada entry yang ditemukan._";
  }

  const lines: string[] = [];
  lines.push(`# Knowledge Report`);
  lines.push("");
  lines.push(`**Total entries:** ${entries.length}`);
  lines.push("");

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];

    lines.push(`## ${index + 1}. ${entry.library}: ${entry.topic}`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **ID** | \`${entry.id}\` |`);
    lines.push(`| **Timestamp** | ${entry.timestamp} |`);
    lines.push(`| **Library** | ${entry.library} |`);
    lines.push(`| **Source** | ${entry.source} |`);

    if (entry.url) {
      lines.push(`| **URL** | ${entry.url} |`);
    }

    // Tags
    if (entry.tags.length > 0) {
      const tags = entry.tags.map((t) => `\`${t}\``).join(", ");
      lines.push(`| **Tags** | ${tags} |`);
    }

    // Relevance
    if (entry.relevance.length > 0) {
      lines.push(`| **Keywords** | ${entry.relevance.join(", ")} |`);
    }

    lines.push("");

    // Content (truncated untuk readability)
    const maxContentLength = 500;
    const content =
      entry.content.length > maxContentLength
        ? entry.content.slice(0, maxContentLength) + `... _(truncated, ${entry.content.length} chars total)_`
        : entry.content;

    lines.push("### Content");
    lines.push("");
    lines.push(content);
    lines.push("");

    if (index < entries.length - 1) {
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Memformat statistik knowledge base menjadi Markdown yang human-readable.
 *
 * @param stats - KnowledgeStats yang akan diformat
 * @returns String Markdown yang sudah diformat
 *
 * @example
 * ```ts
 * const stats = getKnowledgeStats();
 * console.log(formatKnowledgeStats(stats));
 * ```
 */
export function formatKnowledgeStats(stats: KnowledgeStats): string {
  const lines: string[] = [];

  lines.push("# Knowledge Base Statistics");
  lines.push("");
  lines.push(`**Total entries:** ${stats.totalEntries}`);
  lines.push("");

  // By source
  lines.push("## By Source");
  lines.push("| Source | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Context7 | ${stats.bySource.context7} |`);
  lines.push(`| Web | ${stats.bySource.web} |`);
  lines.push(`| Manual | ${stats.bySource.manual} |`);
  lines.push("");

  // By library (top 15)
  const sortedLibraries = Object.entries(stats.byLibrary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (sortedLibraries.length > 0) {
    lines.push("## By Library (top 15)");
    lines.push("| Library | Count |");
    lines.push("|---------|-------|");
    for (const [lib, count] of sortedLibraries) {
      lines.push(`| ${lib} | ${count} |`);
    }
    lines.push("");
  }

  // Top topics
  if (stats.topTopics.length > 0) {
    lines.push("## Top Topics");
    lines.push("| Topic | Count |");
    lines.push("|-------|-------|");
    for (const topic of stats.topTopics) {
      lines.push(`| ${topic.topic} | ${topic.count} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Memformat hasil query knowledge menjadi Markdown yang human-readable.
 *
 * @param result - KnowledgeQueryResult yang akan diformat
 * @returns String Markdown yang sudah diformat
 *
 * @example
 * ```ts
 * const result = queryProjectKnowledge("Next.js authentication");
 * console.log(formatQueryResult(result));
 * ```
 */
export function formatQueryResult(result: KnowledgeQueryResult): string {
  const lines: string[] = [];

  lines.push(`# Knowledge Query: "${result.question}"`);
  lines.push("");
  lines.push(`**Total matches:** ${result.totalMatches}`);
  lines.push(`**Displayed:** ${result.entries.length}`);
  lines.push("");

  if (result.entries.length === 0) {
    lines.push("_Tidak ada entry yang relevan ditemukan._");
    lines.push("");
    lines.push("💡 **Tips:**");
    lines.push("- Gunakan kata kunci yang lebih umum");
    lines.push("- Coba tambahkan knowledge terlebih dahulu dengan `addManualKnowledge()`");
    lines.push("- Atau gunakan `fetchLibraryDocs()` untuk mengambil dokumentasi dari Context7");
    return lines.join("\n");
  }

  for (let index = 0; index < result.entries.length; index++) {
    const entry = result.entries[index];

    lines.push(`### ${index + 1}. [${entry.source}] ${entry.library} — ${entry.topic}`);
    lines.push("");
    lines.push(`- **ID:** \`${entry.id}\``);
    lines.push(`- **Source:** ${entry.source}`);
    lines.push(`- **Timestamp:** ${entry.timestamp}`);

    if (entry.url) {
      lines.push(`- **URL:** ${entry.url}`);
    }

    if (entry.tags.length > 0) {
      lines.push(`- **Tags:** ${entry.tags.join(", ")}`);
    }

    lines.push("");
    // Content excerpt
    const excerpt =
      entry.content.length > 250
        ? entry.content.slice(0, 250) + "..."
        : entry.content;
    lines.push(excerpt);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Memformat best practice suggestions menjadi Markdown yang human-readable.
 *
 * @param suggestions - Array of BestPracticeSuggestion
 * @param taskType - Tipe task (untuk judul laporan)
 * @param framework - Framework yang digunakan
 * @returns String Markdown yang sudah diformat
 */
export function formatSuggestions(
  suggestions: BestPracticeSuggestion[],
  taskType: string,
  framework: string,
): string {
  const lines: string[] = [];

  lines.push(`# Best Practices: ${taskType} pada ${framework}`);
  lines.push("");
  lines.push(`**Total suggestions:** ${suggestions.length}`);
  lines.push("");

  if (suggestions.length === 0) {
    lines.push("_Tidak ada saran best practice yang tersedia._");
    lines.push("");
    lines.push("💡 Gunakan `fetchLibraryDocs()` untuk mengambil dokumentasi terbaru.");
    return lines.join("\n");
  }

  const priorityLabels: Record<string, string> = {
    high: "🔴 High Priority",
    medium: "🟡 Medium Priority",
    low: "🟢 Nice to Have",
  };

  // Group by priority
  const byPriority: Record<string, BestPracticeSuggestion[]> = { high: [], medium: [], low: [] };
  for (const s of suggestions) {
    const p = s.priority in byPriority ? s.priority : "medium";
    byPriority[p].push(s);
  }

  for (const priority of ["high", "medium", "low"] as const) {
    const group = byPriority[priority] ?? [];
    if (group.length === 0) continue;

    lines.push(`## ${priorityLabels[priority] ?? priority}`);
    lines.push("");

    for (let index = 0; index < group.length; index++) {
      const s = group[index];
      lines.push(`### ${index + 1}. ${s.title}`);
      lines.push("");
      lines.push(s.description);
      lines.push("");
      lines.push(`_Source: ${s.source}_`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
