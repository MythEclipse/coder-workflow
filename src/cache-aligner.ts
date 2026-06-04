#!/usr/bin/env node
/**
 * CacheAligner — Prefix Stabilization for KV Cache Optimization
 *
 * Inspired by Headroom's CacheAligner.
 * Stabilizes prefixes of prompts/system messages so that
 * Anthropic/OpenAI provider-side KV caching actually hits.
 *
 * Core mechanism:
 * 1. Standardized prefix format for all agent/skill invocations
 * 2. Prefix tracking to measure cache effectiveness
 * 3. Warm-up sequence to pre-populate KV cache at session start
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────

export interface CachePrefix {
  /** The actual prefix string */
  text: string;
  /** Hash of the prefix for dedup tracking */
  hash: string;
  /** Category for grouping (system, user, tool) */
  category: "system" | "user" | "tool";
  /** Sub-type within category */
  subType?: string;
}

export interface CacheWarmupEntry {
  /** The content to send for warmup */
  content: string;
  /** Category for warmup */
  category: string;
  /** Whether this entry has been warmed */
  warmed: boolean;
}

export interface AlignmentStats {
  /** Total aligned calls */
  totalAlignments: number;
  /** Current prefix in use */
  currentPrefix: string;
  /** Prefix hash for dedup */
  currentHash: string;
  /** Warmup entries status */
  warmupStatus: CacheWarmupEntry[];
}

// ─── Constants ──────────────────────────────────────────────────────────

const ALIGNER_DIR = ".claude/cache-aligner";
const PREFIX_REGISTRY = "prefixes.json";
const WARMUP_REGISTRY = "warmup.json";

const DEFAULT_PREFIX = "coder-workflow | orchestrate | ";

// ─── Prefix Management ──────────────────────────────────────────────────

function ensureDir(): string {
  const dir = join(process.cwd(), ALIGNER_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const STABLE_PREFIXES: Record<string, string> = {
  // System-level prefixes (highest cache hit potential)
  system: "[SYS] coder-workflow | orchestrate | ",

  // Agent level
  "agent:implementer": "[AGENT] coder-workflow | implement | ",
  "agent:auditor": "[AGENT] coder-workflow | audit | ",
  "agent:debugger": "[AGENT] coder-workflow | debug | ",
  "agent:reviewer": "[AGENT] coder-workflow | review | ",
  "agent:tester": "[AGENT] coder-workflow | test | ",
  "agent:ui": "[AGENT] coder-workflow | ui | ",
  "agent:db": "[AGENT] coder-workflow | db | ",
  "agent:deploy": "[AGENT] coder-workflow | deploy | ",
  "agent:docs": "[AGENT] coder-workflow | docs | ",

  // Skill level
  "skill:orchestrator": "[SKILL] coder-workflow | orchestrator | ",
  "skill:plan": "[SKILL] coder-workflow | plan | ",
  "skill:brainstorm": "[SKILL] coder-workflow | brainstorm | ",

  // Generic fallback
  default: DEFAULT_PREFIX,
};

/**
 * Get the aligned prefix for a given type and sub-type.
 * The key insight: same prefix → KV cache hit → lower latency + lower cost.
 */
export function getPrefix(type: string, subType?: string): CachePrefix {
  const key = subType ? `${type}:${subType}` : type;
  const text = STABLE_PREFIXES[key] ?? STABLE_PREFIXES[type] ?? STABLE_PREFIXES.default;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 8);

  return { text, hash, category: "system", subType: key };
}

/**
 * Align content with a standardized prefix.
 * This is the main API — wrap any content that goes to LLM with a stable prefix.
 */
export function alignContent(
  content: string,
  options?: {
    type?: string;
    subType?: string;
    task?: string;
  },
): { aligned: string; prefix: CachePrefix } {
  const prefix = getPrefix(options?.type ?? "default", options?.subType);

  // Add task tag if provided
  const taskTag = options?.task ? `${options.task} | ` : "";

  return {
    aligned: `${prefix.text}${taskTag}${content.trimStart()}`,
    prefix,
  };
}

/**
 * Register a custom prefix for future alignment.
 */
export function registerPrefix(key: string, prefix: string): void {
  STABLE_PREFIXES[key] = prefix;
  trackPrefix(key, prefix);
}

function trackPrefix(key: string, prefix: string): void {
  const dir = ensureDir();
  const filePath = join(dir, PREFIX_REGISTRY);

  let registry: Record<string, string> = {};
  if (existsSync(filePath)) {
    try {
      registry = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // reset on corruption
    }
  }

  registry[key] = prefix;
  writeFileSync(filePath, JSON.stringify(registry, null, 2), "utf-8");
}

// ─── Cache Pre-Warming ───────────────────────────────────────────────────

const DEFAULT_WARMUP_ENTRIES: CacheWarmupEntry[] = [
  {
    content: "[SYS] coder-workflow | orchestrate | pre-warm: system prefix",
    category: "system",
    warmed: false,
  },
  {
    content: "[AGENT] coder-workflow | implement | pre-warm: agent prefix",
    category: "agent",
    warmed: false,
  },
  {
    content: "[AGENT] coder-workflow | audit | pre-warm: audit prefix",
    category: "agent",
    warmed: false,
  },
  {
    content: "[SKILL] coder-workflow | plan | pre-warm: plan prefix",
    category: "skill",
    warmed: false,
  },
];

function cloneDefaults(): CacheWarmupEntry[] {
  return DEFAULT_WARMUP_ENTRIES.map((e) => ({ ...e }));
}

function loadWarmupRegistry(): CacheWarmupEntry[] {
  const dir = ensureDir();
  const filePath = join(dir, WARMUP_REGISTRY);
  if (!existsSync(filePath)) return cloneDefaults();
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return cloneDefaults();
  }
}

function saveWarmupRegistry(entries: CacheWarmupEntry[]): void {
  const dir = ensureDir();
  writeFileSync(join(dir, WARMUP_REGISTRY), JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * Get cache warm-up suggestions — content to send at session start
 * so KV cache is populated with common prefixes.
 */
export function getWarmupSequence(): string[] {
  const entries = loadWarmupRegistry();
  return entries.filter((e) => !e.warmed).map((e) => e.content);
}

/**
 * Mark a warmup entry as completed.
 */
export function markWarmupDone(content: string): void {
  const entries = loadWarmupRegistry();
  const entry = entries.find((e) => e.content === content);
  if (entry) {
    entry.warmed = true;
    saveWarmupRegistry(entries);
  }
}

/**
 * Get alignment statistics.
 */
export function getAlignmentStats(): AlignmentStats {
  const prefix = getPrefix("default");
  const warmups = loadWarmupRegistry();

  return {
    totalAlignments: Object.keys(STABLE_PREFIXES).length,
    currentPrefix: prefix.text,
    currentHash: prefix.hash,
    warmupStatus: warmups,
  };
}

export function resetWarmup(): void {
  const entries = [...DEFAULT_WARMUP_ENTRIES];
  saveWarmupRegistry(entries);
}
