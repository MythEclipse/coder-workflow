#!/usr/bin/env node
/**
 * Cross-Agent Memory — Multi-Platform Memory Store
 *
 * Inspired by Headroom's cross-agent shared memory.
 * Format agnostic — readable by Claude, Codex, Gemini, Cursor.
 *
 * Design:
 * - Markdown + YAML frontmatter for human/LLM readability
 * - agent_provenance tracking for traceability
 * - Auto-dedup by content hash
 * - Platform metadata for cross-agent interop
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "./utils/index.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface AgentMemoryEntry {
  id: string;
  name: string;
  description: string;
  content: string;
  agentProvenance: Array<{
    agent: string;
    platform: "claude" | "codex" | "gemini" | "cursor" | "other";
    timestamp: string;
  }>;
  tags: string[];
  platform: "claude" | "codex" | "gemini" | "cursor" | "other";
  memoryType: "lesson" | "decision" | "fact" | "reference" | "feedback";
  createdAt: string;
  updatedAt: string;
  contentHash: string;
}

export interface AgentMemoryStore {
  entries: AgentMemoryEntry[];
  version: number;
  lastSync: string;
}

export interface MemoryQuery {
  platforms?: string[];
  agentName?: string;
  memoryType?: string;
  tags?: string[];
  searchText?: string;
  limit?: number;
}

export interface SyncResult {
  synced: number;
  conflicts: number;
  newEntries: number;
}

// ─── Constants ──────────────────────────────────────────────────────────

const MEMORY_DIR = ".claude/cross-agent-memory";
const MEMORY_INDEX = "memory-index.json";
const MEMORY_STORE_VERSION = 1;

const PLATFORM_NAMES = {
  claude: "Claude Code",
  codex: "Amazon Codex",
  gemini: "Gemini Code Assist",
  cursor: "Cursor",
  other: "Other",
} as const;

// ─── Storage ────────────────────────────────────────────────────────────

function ensureMemDir(): string {
  return ensureDir(join(process.cwd(), MEMORY_DIR));
}

function loadStore(): AgentMemoryStore {
  const dir = ensureMemDir();
  const indexPath = join(dir, MEMORY_INDEX);

  if (!existsSync(indexPath)) {
    return { entries: [], version: MEMORY_STORE_VERSION, lastSync: new Date().toISOString() };
  }

  try {
    const data = JSON.parse(readFileSync(indexPath, "utf-8"));
    return {
      entries: data.entries ?? [],
      version: data.version ?? MEMORY_STORE_VERSION,
      lastSync: data.lastSync ?? new Date().toISOString(),
    };
  } catch {
    return { entries: [], version: MEMORY_STORE_VERSION, lastSync: new Date().toISOString() };
  }
}

function saveStore(store: AgentMemoryStore): void {
  const dir = ensureMemDir();
  store.lastSync = new Date().toISOString();
  writeFileSync(join(dir, MEMORY_INDEX), JSON.stringify(store, null, 2), "utf-8");
}

function getContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// ─── CRUD ───────────────────────────────────────────────────────────────

/**
 * Store a new memory entry. Auto-deduplicates by content hash.
 */
export function storeMemory(entry: {
  name: string;
  description: string;
  content: string;
  agentName: string;
  platform?: AgentMemoryEntry["platform"];
  tags?: string[];
  memoryType?: AgentMemoryEntry["memoryType"];
}): AgentMemoryEntry {
  const store = loadStore();
  const contentHash = getContentHash(entry.content);

  // Auto-dedup: check if identical content exists
  const existing = store.entries.find((e) => e.contentHash === contentHash);
  if (existing) {
    // Add provenance if new agent
    if (!existing.agentProvenance.some((p) => p.agent === entry.agentName)) {
      existing.agentProvenance.push({
        agent: entry.agentName,
        platform: entry.platform ?? "claude",
        timestamp: new Date().toISOString(),
      });
      existing.updatedAt = new Date().toISOString();
      saveStore(store);
    }
    return existing;
  }

  // Generate unique ID based on name + timestamp
  const id = `mem-${entry.name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .toLowerCase()
    .slice(0, 40)}-${Date.now().toString(36)}`;

  const newEntry: AgentMemoryEntry = {
    id,
    name: entry.name,
    description: entry.description,
    content: entry.content,
    agentProvenance: [
      {
        agent: entry.agentName,
        platform: entry.platform ?? "claude",
        timestamp: new Date().toISOString(),
      },
    ],
    tags: entry.tags ?? [],
    platform: entry.platform ?? "claude",
    memoryType: entry.memoryType ?? "lesson",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash,
  };

  store.entries.push(newEntry);
  saveStore(store);
  return newEntry;
}

/**
 * Query memory entries by various criteria.
 */
export function queryMemory(query: MemoryQuery): AgentMemoryEntry[] {
  const store = loadStore();
  let entries = [...store.entries];

  if (query.platforms && query.platforms.length > 0) {
    entries = entries.filter((e) => query.platforms!.includes(e.platform));
  }
  if (query.agentName) {
    entries = entries.filter((e) =>
      e.agentProvenance.some((p) => p.agent.toLowerCase().includes(query.agentName!.toLowerCase())),
    );
  }
  if (query.memoryType) {
    entries = entries.filter((e) => e.memoryType === query.memoryType);
  }
  if (query.tags && query.tags.length > 0) {
    entries = entries.filter((e) =>
      query.tags!.some((t) => e.tags.some((et) => et.toLowerCase() === t.toLowerCase())),
    );
  }
  if (query.searchText) {
    const text = query.searchText.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.name.toLowerCase().includes(text) ||
        e.description.toLowerCase().includes(text) ||
        e.content.toLowerCase().includes(text),
    );
  }

  // Sort by updatedAt descending
  entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return query.limit ? entries.slice(0, query.limit) : entries;
}

/**
 * Get a single memory entry by ID.
 */
export function getMemoryById(id: string): AgentMemoryEntry | undefined {
  const store = loadStore();
  return store.entries.find((e) => e.id === id);
}

/**
 * Get all memory entries (with optional limit).
 */
export function getAllMemories(limit?: number): AgentMemoryEntry[] {
  return queryMemory({ limit });
}

/**
 * Delete a memory entry by ID.
 */
export function deleteMemory(id: string): boolean {
  const store = loadStore();
  const index = store.entries.findIndex((e) => e.id === id);
  if (index === -1) return false;

  store.entries.splice(index, 1);
  saveStore(store);
  return true;
}

/**
 * Get memory statistics.
 */
export function getMemoryStats(): {
  totalEntries: number;
  byPlatform: Record<string, number>;
  byType: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
  agentsInvolved: string[];
} {
  const store = loadStore();
  const byPlatform: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const tagCount: Record<string, number> = {};
  const agentsSet = new Set<string>();

  for (const entry of store.entries) {
    byPlatform[entry.platform] = (byPlatform[entry.platform] ?? 0) + 1;
    byType[entry.memoryType] = (byType[entry.memoryType] ?? 0) + 1;

    for (const tag of entry.tags) {
      tagCount[tag] = (tagCount[tag] ?? 0) + 1;
    }

    for (const p of entry.agentProvenance) {
      agentsSet.add(`${p.platform}:${p.agent}`);
    }
  }

  const topTags = Object.entries(tagCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalEntries: store.entries.length,
    byPlatform,
    byType,
    topTags,
    agentsInvolved: [...agentsSet].sort(),
  };
}

// ─── Cross-Platform Export ──────────────────────────────────────────────

/**
 * Export memory in a platform-agnostic Markdown format.
 * Other agents (Codex, Gemini, Cursor) can read this directly.
 */
export function exportToMarkdown(options?: { platforms?: string[]; memoryType?: string }): string {
  const store = loadStore();
  let entries = store.entries;

  if (options?.platforms) {
    entries = entries.filter((e) => options.platforms!.includes(e.platform));
  }
  if (options?.memoryType) {
    entries = entries.filter((e) => e.memoryType === options.memoryType);
  }

  const sections = [
    "# Cross-Agent Memory Store",
    "",
    `*Generated: ${new Date().toISOString()}*`,
    `*Total entries: ${entries.length}*`,
    `*Format: Platform-agnostic Markdown*`,
    "",
    "---",
    "",
  ];

  for (const entry of entries) {
    const agents = entry.agentProvenance
      .map((p) => `${PLATFORM_NAMES[p.platform]} (@${p.agent})`)
      .join(", ");

    sections.push(
      `## ${entry.name}`,
      "",
      `**Type:** ${entry.memoryType}  `,
      `**Tags:** ${entry.tags.join(", ") || "none"}  `,
      `**Agents:** ${agents}  `,
      `**Created:** ${entry.createdAt}  `,
      `**Updated:** ${entry.updatedAt}  `,
      "",
      entry.description,
      "",
      "```",
      entry.content,
      "```",
      "",
      "---",
      "",
    );
  }

  return sections.join("\n");
}

/**
 * Export in YAML format for CI/automation tools.
 */
export function exportToYaml(options?: { filters?: MemoryQuery }): string {
  const entries = options?.filters ? queryMemory(options.filters) : getAllMemories();

  const yamlLines = [
    "# Cross-Agent Memory Store (YAML)",
    "# Platform-agnostic format for CI/CD pipelines",
    `generated: ${new Date().toISOString()}`,
    `count: ${entries.length}`,
    "entries:",
  ];

  for (const entry of entries) {
    yamlLines.push(
      `  - id: ${entry.id}`,
      `    name: ${entry.name}`,
      `    type: ${entry.memoryType}`,
      `    platform: ${entry.platform}`,
      `    tags: [${entry.tags.join(", ")}]`,
      `    agents: [${entry.agentProvenance.map((p) => `${p.platform}:${p.agent}`).join(", ")}]`,
      `    content: |`,
      ...entry.content.split("\n").map((line) => `      ${line}`),
      "",
    );
  }

  return yamlLines.join("\n");
}

// ─── Sync (Cross-Platform) ──────────────────────────────────────────────

/**
 * Simulate sync with another platform's memory store.
 * In production this would talk to each platform's API.
 * For now it reads/writes files in platform-specific subdirectories.
 */
export function syncWithPlatform(platform: AgentMemoryEntry["platform"]): SyncResult {
  const store = loadStore();
  const dir = ensureMemDir();
  const platformDir = join(dir, `platform-${platform}`);

  if (!existsSync(platformDir)) {
    mkdirSync(platformDir, { recursive: true });
  }

  let synced = 0;
  let conflicts = 0;
  let newEntries = 0;

  // Scan platform-specific memory files
  const files = readdirSync(platformDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(platformDir, file), "utf-8")) as AgentMemoryEntry;

      // Check for conflicts by content hash
      const existing = store.entries.find((e) => e.contentHash === data.contentHash);
      if (existing) {
        // Merge provenance
        for (const prov of data.agentProvenance) {
          if (
            !existing.agentProvenance.some(
              (p) => p.agent === prov.agent && p.platform === prov.platform,
            )
          ) {
            existing.agentProvenance.push(prov);
            existing.updatedAt = new Date().toISOString();
            conflicts++;
          }
        }
      } else {
        // New entry from other platform
        store.entries.push(data);
        newEntries++;
      }
      synced++;
    } catch {
      // skip invalid files
    }
  }

  if (synced > 0) {
    saveStore(store);
  }

  return { synced, conflicts, newEntries };
}

/**
 * Platform name for display.
 */
export function getPlatformDisplayName(platform: AgentMemoryEntry["platform"]): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

/**
 * Get all supported platforms.
 */
export function getSupportedPlatforms(): Array<{
  id: AgentMemoryEntry["platform"];
  name: string;
}> {
  return Object.entries(PLATFORM_NAMES).map(([id, name]) => ({
    id: id as AgentMemoryEntry["platform"],
    name,
  }));
}
