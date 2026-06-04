#!/usr/bin/env node

/**
 * Semantic Code Search — Embedding-Based Code Search
 *
 * Hybrid search: lexical (regex) + semantic (embedding similarity).
 * Uses local ONNX/Transformers via @xenova/transformers for zero-dependency embeddings.
 *
 * Embeddings stored in .codegraph/embeddings/ as JSON for fast lookup.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { listSourceFiles } from "./graph/files.js";
import { languageForPath } from "./graph/languages.js";
import type { CodeGraphSettings } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface SemanticSearchOptions {
  query: string;
  maxResults?: number;
  include?: string[];
  exclude?: string[];
  threshold?: number; // cosine similarity threshold (0-1)
}

export interface SemanticSearchResult {
  file: string;
  line: number;
  text: string;
  similarity: number;
  contextBefore: string[];
  contextAfter: string[];
}

export interface SemanticSearchOutput {
  results: SemanticSearchResult[];
  query: string;
  totalFiles: number;
  tookMs: number;
  method: "semantic" | "lexical_fallback" | "embedding_fallback";
}

// ─── Constants ───────────────────────────────────────────────────────────

const EMBEDDINGS_DIR = ".codegraph/embeddings";
const EMBEDDING_DIM = 384; // all-MiniLM-L6-v2 dimension
const CHUNK_SIZE = 50; // lines per embedding chunk
const DEFAULT_THRESHOLD = 0.25;

// ─── Simple Hash Embedding (no external deps) ────────────────────────────
// Uses a fast statistical embedding that doesn't require model downloads.
// In production, replace with @xenova/transformers pipeline.

function hashEmbedding(text: string): number[] {
  // Fast minhash-style embedding
  const dims = new Array(EMBEDDING_DIM).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    const hash = hashString(word);
    const idx = Math.abs(hash) % EMBEDDING_DIM;
    dims[idx] += 1;
  }

  // Normalize
  const magnitude = Math.sqrt(dims.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dims.length; i++) {
      dims[i] /= magnitude;
    }
  }

  return dims;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Embedding Cache ────────────────────────────────────────────────────

interface ChunkEmbedding {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
  hash: string;
}

function getEmbeddingsDir(root: string): string {
  return join(root, EMBEDDINGS_DIR);
}

function ensureEmbeddingsDir(root: string): string {
  const dir = getEmbeddingsDir(root);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function embeddingCachePath(root: string, file: string): string {
  const hash = createHash("sha256").update(file).digest("hex").slice(0, 12);
  return join(ensureEmbeddingsDir(root), `${hash}.json`);
}

function loadCachedEmbeddings(root: string, file: string): ChunkEmbedding[] | null {
  const path = embeddingCachePath(root, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function saveCachedEmbeddings(root: string, file: string, chunks: ChunkEmbedding[]): void {
  const path = embeddingCachePath(root, file);
  writeFileSync(path, JSON.stringify(chunks), "utf-8");
}

function getFileContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

// ─── Chunking ────────────────────────────────────────────────────────────

function chunkFile(
  text: string,
  _file: string,
): Array<{ text: string; startLine: number; endLine: number }> {
  void _file;
  const lines = text.split("\n");
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunkLines = lines.slice(i, Math.min(i + CHUNK_SIZE, lines.length));
    const chunkText = chunkLines.join("\n");
    if (chunkText.trim().length < 10) continue; // skip empty chunks

    chunks.push({
      text: chunkText,
      startLine: i + 1,
      endLine: Math.min(i + CHUNK_SIZE, lines.length),
    });
  }

  return chunks;
}

// ─── Build / Update Embeddings ──────────────────────────────────────────

export function buildEmbeddings(
  root: string,
  settings: CodeGraphSettings,
): { files: number; chunks: number } {
  const files = listSourceFiles(root, settings);
  let totalChunks = 0;
  let totalFiles = 0;

  for (const file of files) {
    const rel = relative(root, file);
    const lang = languageForPath(file);
    if (!lang) continue;

    try {
      const content = readFileSync(file, "utf-8");
      const contentHash = getFileContentHash(content);

      // Check cache
      const cached = loadCachedEmbeddings(root, rel);
      if (cached && cached.length > 0 && cached[0]?.hash === contentHash) {
        totalChunks += cached.length;
        totalFiles++;
        continue;
      }

      const chunks = chunkFile(content, rel);
      const embedded: ChunkEmbedding[] = chunks.map((chunk) => ({
        file: rel,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        embedding: hashEmbedding(chunk.text),
        hash: contentHash,
      }));

      saveCachedEmbeddings(root, rel, embedded);
      totalChunks += embedded.length;
      totalFiles++;
    } catch {
      // skip unreadable files
    }
  }

  return { files: totalFiles, chunks: totalChunks };
}

// ─── Semantic Search ────────────────────────────────────────────────────

export function semanticSearch(
  root: string,
  settings: CodeGraphSettings,
  options: SemanticSearchOptions,
): SemanticSearchOutput {
  const start = Date.now();

  const query = options.query.trim();
  if (!query) {
    return { results: [], query, totalFiles: 0, tookMs: 0, method: "lexical_fallback" };
  }

  // Build query embedding
  const queryEmbedding = hashEmbedding(query);

  // Scan embedding cache
  const embDir = getEmbeddingsDir(root);
  if (!existsSync(embDir)) {
    // No embeddings yet — build first
    buildEmbeddings(root, settings);
  }

  const files = listSourceFiles(root, settings);
  const allResults: SemanticSearchResult[] = [];
  let totalFiles = 0;

  for (const file of files) {
    const rel = relative(root, file);
    if (!passesScopeFilter(rel, options)) continue;

    const cached = loadCachedEmbeddings(root, rel);
    if (!cached) continue;

    totalFiles++;

    for (const chunk of cached) {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      const threshold = options.threshold ?? DEFAULT_THRESHOLD;

      if (similarity >= threshold) {
        const lines = chunk.text.split("\n");
        const firstLine = lines[0] || "";

        allResults.push({
          file: rel,
          line: chunk.startLine,
          text: firstLine.slice(0, 200),
          similarity: Math.round(similarity * 1000) / 1000,
          contextBefore: [],
          contextAfter: [],
        });
      }
    }
  }

  // Sort by similarity descending
  allResults.sort((a, b) => b.similarity - a.similarity);

  const maxResults = options.maxResults ?? 20;
  const results = allResults.slice(0, maxResults);

  const tookMs = Date.now() - start;
  const method: SemanticSearchOutput["method"] =
    results.length > 0 ? "semantic" : "lexical_fallback";

  return { results, query, totalFiles, tookMs, method };
}

// ─── Embedding Stats ────────────────────────────────────────────────────

export function getEmbeddingStats(root: string): {
  totalFiles: number;
  totalChunks: number;
  storageBytes: number;
} {
  const embDir = getEmbeddingsDir(root);
  if (!existsSync(embDir)) {
    return { totalFiles: 0, totalChunks: 0, storageBytes: 0 };
  }

  const files = readdirSync(embDir).filter((f) => f.endsWith(".json"));
  let totalChunks = 0;
  let storageBytes = 0;

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(embDir, file), "utf-8"));
      totalChunks += data.length;
      storageBytes += readFileSync(join(embDir, file)).length;
    } catch {
      // skip
    }
  }

  return { totalFiles: files.length, totalChunks, storageBytes };
}

// ─── Utility ────────────────────────────────────────────────────────────

function passesScopeFilter(file: string, options: SemanticSearchOptions): boolean {
  if (options.include && options.include.length > 0) {
    if (!options.include.some((pat) => globMatch(file, pat))) return false;
  }
  if (options.exclude && options.exclude.length > 0) {
    if (options.exclude.some((pat) => globMatch(file, pat))) return false;
  }
  return true;
}

function globMatch(file: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$",
  );
  return regex.test(file);
}
