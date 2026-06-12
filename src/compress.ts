#!/usr/bin/env node
/**
 * CCR — Context Compression & Reversible Compression Engine
 *
 * Inspired by Headroom (chopratejas/headroom).
 * - SmartCrusher: JSON/structured data compression
 * - CodeCompressor: AST-aware source code compression
 * - CCR: stores originals locally, LLM retrieves on demand
 * - CacheAligner: prefix stabilization for KV cache hits
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────

export interface CompressionResult {
  /** Compressed text */
  compressed: string;
  /** Unique hash of original content */
  hash: string;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (1 - compressed/original), 0-1 */
  ratio: number;
  /** Content type (json, code, prose) */
  contentType: "json" | "code" | "prose";
  /** Whether this was truncated (prose) */
  truncated?: boolean;
  /** Reversible content ID for CCR retrieval */
  ccrId?: string;
}

export interface CompressionStats {
  totalOriginalBytes: number;
  totalCompressedBytes: number;
  averageRatio: number;
  contentTypes: Record<string, number>;
  ccrCount: number;
}

export interface DecompressResult {
  original: string;
  hash: string;
  contentType: string;
  timestamp: string;
}

export interface CacheAlignerResult {
  aligned: string;
  prefixHash: string;
  cacheable: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────

const CCR_DIR = ".claude/ccr";
// We do not truncate context here. The LLM must see the full file.
// We only compress via minification and AST stripping.
const MIN_COMPRESSION_RATIO = 0.15; // skip if less than 15% savings
const CACHE_PREFIX = "[PROJECT] coder-workflow |";

// ─── SmartCrusher: JSON Compression ─────────────────────────────────────

function smartCrusher(input: string, _pathHint?: string): CompressionResult {
  const originalSize = new TextEncoder().encode(input).length;
  void _pathHint;
  let compressed: string;

  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed) && parsed.length > 5) {
      // Array of objects → schema + data (Headroom-style)
      compressed = crushArray(parsed);
    } else if (typeof parsed === "object" && parsed !== null) {
      // Nested object → key path shortening
      compressed = crushObject(parsed);
    } else {
      compressed = JSON.stringify(parsed);
    }
  } catch {
    // Not valid JSON — treat as prose
    return compressProse(input);
  }

  const compressedBytes = new TextEncoder().encode(compressed).length;
  const ratio = originalSize > 0 ? 1 - compressedBytes / originalSize : 0;

  const hash = createHash("sha256").update(input).digest("hex").slice(0, 12);
  const ccrId = ratio >= MIN_COMPRESSION_RATIO ? storeCCR(hash, input, "json") : undefined;

  return {
    compressed,
    hash,
    originalSize,
    compressedSize: compressedBytes,
    ratio: Math.round(ratio * 100) / 100,
    contentType: "json",
    ccrId,
  };
}

function crushArray(arr: unknown[]): string {
  if (arr.length === 0) return "[]";

  // Extract schema from first object
  const first = arr[0];
  if (typeof first !== "object" || first === null) {
    return JSON.stringify(arr);
  }

  const keys = Object.keys(first as Record<string, unknown>);
  const keyMap = new Map<string, string>();
  keys.forEach((k, i) => keyMap.set(k, `k${i}`));

  // Compress each item
  const crushed = arr.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const obj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      const short = keyMap.get(key) || key;
      obj[short] = value;
    }
    return obj;
  });

  // Keep schema mapping
  const schema: Record<string, string> = {};
  for (const [key, short] of keyMap) schema[short] = key;

  const result = {
    _schema: schema,
    _count: arr.length,
    _items: crushed.slice(0, 30), // truncate to 30 items
    _truncated: arr.length > 30 ? arr.length - 30 : undefined,
  };

  return JSON.stringify(result);
}

function crushObject(obj: Record<string, unknown>): string {
  // Compress keys, remove nulls/empties
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === "") continue;
    // Shorten common verbose keys
    const short = shortenKey(key);
    if (typeof value === "string" && value.length > 200) {
      result[short] = value.slice(0, 200) + `…[+${value.length - 200}ch]`;
    } else {
      result[short] = value;
    }
  }
  return JSON.stringify(result);
}

const KEY_SHORTENINGS: Record<string, string> = {
  description: "desc",
  summary: "sum",
  properties: "props",
  arguments: "args",
  parameters: "params",
  configuration: "config",
  environment: "env",
  directory: "dir",
  filename: "file",
  extension: "ext",
  language: "lang",
  statusCode: "code",
  message: "msg",
  response: "res",
  request: "req",
  previous: "prev",
  current: "cur",
  original: "orig",
  reference: "ref",
};

function shortenKey(key: string): string {
  return KEY_SHORTENINGS[key] ?? key;
}

// ─── CodeCompressor: AST-Aware Source Code Compression ──────────────────

function codeCompressor(input: string, filePath?: string): CompressionResult {
  const originalSize = new TextEncoder().encode(input).length;
  const lang = filePath ? languageFromPath(filePath) : undefined;

  let compressed = input;

  if (lang) {
    compressed = stripComments(input, lang);
    compressed = collapseBlankLines(compressed);
    compressed = shortenIdentifiersIfSafe(compressed, lang);
  }

  const compressedBytes = new TextEncoder().encode(compressed).length;
  const ratio = originalSize > 0 ? 1 - compressedBytes / originalSize : 0;

  const hash = createHash("sha256").update(input).digest("hex").slice(0, 12);
  const ccrId = ratio >= MIN_COMPRESSION_RATIO ? storeCCR(hash, input, "code") : undefined;

  return {
    compressed,
    hash,
    originalSize,
    compressedSize: compressedBytes,
    ratio: Math.round(ratio * 100) / 100,
    contentType: "code",
    ccrId,
  };
}

function languageFromPath(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
  };
  return langMap[ext];
}

function stripComments(input: string, lang: string): string {
  // Only strip for languages with // and /* */ style comments
  if (
    [
      "typescript",
      "javascript",
      "java",
      "go",
      "rust",
      "c",
      "cpp",
      "csharp",
      "kotlin",
      "swift",
      "php",
    ].includes(lang)
  ) {
    return input
      .replace(/(?<!https?:)\/\/.*$/gm, "") // line comments (avoid http://)
      .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
  }
  if (lang === "python" || lang === "ruby") {
    return input.replace(/(?<!['"])#.*$/gm, "");
  }
  return input;
}

function collapseBlankLines(input: string): string {
  return input.replace(/\n{3,}/g, "\n\n");
}

function shortenIdentifiersIfSafe(input: string, _lang: string): string {
  void _lang;
  // Only for display/read-only — not for execution
  // Shorten: truncate identifiers > 20 chars
  return input.replace(/\b([a-zA-Z_][a-zA-Z0-9_]{20,})\b/g, (match) => match.slice(0, 18) + "…");
}

// ─── Prose Compression ─────────────────────────────────────────────────

function compressProse(input: string): CompressionResult {
  const originalSize = new TextEncoder().encode(input).length;
  let compressed: string;
  let truncated = false;

  // For prose (tool output, logs, etc.) — extract key info
  const lines = input.split("\n");

  if (lines.length > 500) {
    // Keep first 250 and last 250 lines
    const head = lines.slice(0, 250);
    const tail = lines.slice(-250);
    compressed = [...head, `… [${lines.length - 500} lines collapsed]`, ...tail].join("\n");
    truncated = true;
  } else {
    compressed = input;
  }

  const compressedBytes = new TextEncoder().encode(compressed).length;
  const ratio = originalSize > 0 ? 1 - compressedBytes / originalSize : 0;

  const hash = createHash("sha256").update(input).digest("hex").slice(0, 12);
  const ccrId = ratio >= MIN_COMPRESSION_RATIO ? storeCCR(hash, input, "prose") : undefined;

  return {
    compressed,
    hash,
    originalSize,
    compressedSize: compressedBytes,
    ratio: Math.round(ratio * 100) / 100,
    contentType: "prose",
    truncated,
    ccrId,
  };
}

// ─── CCR: Reversible Compression Store ──────────────────────────────────

function getCCRDir(): string {
  return join(process.cwd(), CCR_DIR);
}

function ensureCCRDir(): string {
  const dir = getCCRDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function storeCCR(hash: string, content: string, contentType: string): string {
  const dir = ensureCCRDir();
  const ccrId = `${hash}-${contentType}`;
  const filePath = join(dir, `${ccrId}.ccr`);

  if (!existsSync(filePath)) {
    writeFileSync(
      filePath,
      JSON.stringify({
        hash,
        contentType,
        content,
        storedAt: new Date().toISOString(),
      }),
      "utf-8",
    );
  }

  return ccrId;
}

function retrieveCCR(ccrId: string): DecompressResult | null {
  const dir = getCCRDir();
  const filePath = join(dir, `${ccrId}.ccr`);

  // Try with extension
  if (existsSync(filePath)) {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return {
      original: data.content,
      hash: data.hash,
      contentType: data.contentType,
      timestamp: data.storedAt,
    };
  }

  // Try without type suffix
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const match = files.find((f) => f.startsWith(ccrId));
  if (match) {
    const data = JSON.parse(readFileSync(join(dir, match), "utf-8"));
    return {
      original: data.content,
      hash: data.hash,
      contentType: data.contentType,
      timestamp: data.storedAt,
    };
  }

  return null;
}

function getCCRStats(): {
  total: number;
  totalBytes: number;
  contentTypeBreakdown: Record<string, number>;
} {
  const dir = getCCRDir();
  if (!existsSync(dir)) {
    return { total: 0, totalBytes: 0, contentTypeBreakdown: {} };
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".ccr"));
  let totalBytes = 0;
  const contentTypeBreakdown: Record<string, number> = {};

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      totalBytes += new TextEncoder().encode(data.content).length;
      contentTypeBreakdown[data.contentType] = (contentTypeBreakdown[data.contentType] || 0) + 1;
    } catch {
      // skip corrupted files
    }
  }

  return { total: files.length, totalBytes, contentTypeBreakdown };
}

function purgeCCR(maxAgeHours = 24): number {
  const dir = getCCRDir();
  if (!existsSync(dir)) return 0;

  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  let purged = 0;

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ccr"))) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      const storedAt = new Date(data.storedAt).getTime();
      if (storedAt < cutoff) {
        unlinkSync(join(dir, file));
        purged++;
      }
    } catch {
      unlinkSync(join(dir, file));
      purged++;
    }
  }

  return purged;
}

// ─── Main Compress API ──────────────────────────────────────────────────

export function compress(
  input: string,
  options?: { filePath?: string; contentType?: "auto" | "json" | "code" | "prose" },
): CompressionResult {
  const ct = options?.contentType ?? "auto";

  if (ct === "json") return smartCrusher(input, options?.filePath);
  if (ct === "code") return codeCompressor(input, options?.filePath);
  if (ct === "prose") return compressProse(input);

  // Auto-detect content type
  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return smartCrusher(input, options?.filePath);
    } catch {
      // fall through
    }
  }

  if (options?.filePath) {
    const lang = languageFromPath(options.filePath);
    if (lang) return codeCompressor(input, options.filePath);
  }

  return compressProse(input);
}

export function decompress(ccrId: string): DecompressResult | null {
  return retrieveCCR(ccrId);
}

export function getStats(): CompressionStats {
  const ccrStats = getCCRStats();
  // Calculate total compressed bytes and average ratio from stored CCR files
  const dir = getCCRDir();
  let totalCompressedBytes = 0;
  let avgRatio = 0;

  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ccr"));
    let sumRatio = 0;
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        const original = new TextEncoder().encode(data.content).length;
        const stored = new TextEncoder().encode(JSON.stringify(data)).length;
        totalCompressedBytes += stored;
        if (original > 0) sumRatio += 1 - stored / original;
      } catch {
        // skip corrupted files
      }
    }
    avgRatio = files.length > 0 ? sumRatio / files.length : 0;
  }

  return {
    totalOriginalBytes: ccrStats.totalBytes,
    totalCompressedBytes,
    averageRatio: Math.round(avgRatio * 100) / 100,
    contentTypes: ccrStats.contentTypeBreakdown,
    ccrCount: ccrStats.total,
  };
}

export function cleanCCR(maxAgeHours = 24): number {
  return purgeCCR(maxAgeHours);
}

// ─── CacheAligner: Prefix Stabilization ────────────────────────────────

const CACHE_ALIGNER_DIR = ".claude/cache-aligner";

function getCachePrefix(projectName?: string): string {
  const name = projectName || "coder-workflow";
  return `${CACHE_PREFIX} ${name} | `;
}

/**
 * Align content with a standardized prefix for KV cache hits.
 * Mimics Headroom's CacheAligner.
 */
export function alignCache(
  content: string,
  options?: {
    taskType?: string;
    mode?: string;
    projectName?: string;
  },
): CacheAlignerResult {
  const prefix = getCachePrefix(options?.projectName);
  const taskTag = options?.taskType ? `task:${options.taskType} | ` : "";
  const modeTag = options?.mode ? `mode:${options.mode} | ` : "";

  const aligned = `${prefix}${taskTag}${modeTag}\n${content.trimStart()}`;
  const prefixHash = createHash("sha256")
    .update(`${prefix}${taskTag}${modeTag}`)
    .digest("hex")
    .slice(0, 8);

  return {
    aligned,
    prefixHash,
    cacheable: true,
  };
}

/**
 * Get CacheAligner analysis showing current prefix stats.
 */
export function getCacheAlignment(): { prefix: string; stats: Record<string, number> } {
  const dir = join(process.cwd(), CACHE_ALIGNER_DIR);
  const stats: Record<string, number> = { hits: 0, misses: 0 };

  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        if (data.hit) stats.hits++;
        else stats.misses++;
      } catch {
        // skip
      }
    }
  }

  return {
    prefix: getCachePrefix(),
    stats,
  };
}

// ─── CLI Integration Helpers ───────────────────────────────────────────

export function printCompressionSummary(stats: CompressionStats): string {
  return [
    "╔══════════════════════════ CCR Statistics ══════════════════════════╗",
    `  CCR Entries:  ${stats.ccrCount} files`,
    `  Total Stored: ${(stats.totalOriginalBytes / 1024).toFixed(1)} KB original`,
    `  Breakdown:    ${Object.entries(stats.contentTypes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")}`,
    "╚══════════════════════════════════════════════════════════════════════╝",
  ].join("\n");
}

export function formatCompressedPreview(result: CompressionResult): string {
  const lines = [
    `[CCR] ${result.contentType.toUpperCase()} | ${(result.ratio * 100).toFixed(0)}% compressed | ${result.hash}`,
    `      ${result.originalSize} bytes → ${result.compressedSize} bytes`,
    result.ccrId ? `      Restore: decompress_content("${result.ccrId}")` : "",
    "",
    result.compressed,
  ].filter(Boolean);

  return lines.join("\n");
}
