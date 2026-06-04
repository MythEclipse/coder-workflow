import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  exportToMarkdown,
  getMemoryStats,
  getPlatformDisplayName,
  getSupportedPlatforms,
  queryMemory,
  storeMemory,
  syncWithPlatform,
} from "../src/cross-agent-memory.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "cam-test-"));
  const orig = process.cwd();
  process.chdir(dir);
  return orig;
}

function restoreCwd(orig: string, tmp: string): void {
  process.chdir(orig);
  rmSync(tmp, { recursive: true, force: true });
}

function sampleEntry() {
  return {
    name: "test-bug-fix",
    description: "How to fix timeout errors",
    content: "Increase timeout to 60s for large payloads",
    agentName: "debugger-01",
    platform: "claude" as const,
    tags: ["timeout", "debug"],
    memoryType: "lesson" as const,
  };
}

// ─── storeMemory ──────────────────────────────────────────────────────────────

test("storeMemory creates a new entry and assigns id", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const entry = storeMemory(sampleEntry());

    assert.ok(entry.id.startsWith("mem-"), "id should start with mem-");
    assert.equal(entry.name, "test-bug-fix");
    assert.equal(entry.memoryType, "lesson");
    assert.equal(entry.platform, "claude");
    assert.deepEqual(entry.agentProvenance, [
      { agent: "debugger-01", platform: "claude", timestamp: entry.createdAt },
    ]);
    assert.ok(entry.contentHash.length > 0, "content hash should be generated");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("storeMemory auto-deduplicates by content hash", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const entry1 = storeMemory(sampleEntry());
    const entry2 = storeMemory(sampleEntry());

    // Should return the same entry (id matches)
    assert.equal(entry1.id, entry2.id, "identical content should produce same entry");
    assert.equal(entry1.contentHash, entry2.contentHash);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("storeMemory adds provenance on deduplication when agent differs", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const entry1 = storeMemory(sampleEntry());
    const entry2 = storeMemory({ ...sampleEntry(), agentName: "implementer-42" });

    // Same id but provenance should have both agents
    assert.equal(entry1.id, entry2.id);
    assert.equal(entry2.agentProvenance.length, 2);
    assert.ok(entry2.agentProvenance.some((p) => p.agent === "debugger-01"));
    assert.ok(entry2.agentProvenance.some((p) => p.agent === "implementer-42"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("storeMemory does not add duplicate provenance for same agent", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    const entry2 = storeMemory(sampleEntry());

    assert.equal(entry2.agentProvenance.length, 1, "same agent should not duplicate provenance");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("storeMemory uses default platform and memoryType when not provided", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const entry = storeMemory({
      name: "simple",
      description: "desc",
      content: "content",
      agentName: "test",
    });

    assert.equal(entry.platform, "claude");
    assert.equal(entry.memoryType, "lesson");
    assert.deepEqual(entry.tags, []);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("storeMemory supports other platform and various memory types", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const entry = storeMemory({
      name: "decision-1",
      description: "Architecture decision",
      content: "Use postgres for persistence",
      agentName: "architect",
      platform: "gemini",
      memoryType: "decision",
      tags: ["architecture", "database"],
    });

    assert.equal(entry.platform, "gemini");
    assert.equal(entry.memoryType, "decision");
    assert.deepEqual(entry.tags, ["architecture", "database"]);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── queryMemory ──────────────────────────────────────────────────────────────

test("queryMemory returns all entries when no filters", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({ ...sampleEntry(), name: "entry-2", content: "different content" });

    const results = queryMemory({});
    assert.equal(results.length, 2);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory filters by platform", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({
      ...sampleEntry(),
      name: "codex-entry",
      content: "codex content",
      platform: "codex",
    });

    const claude = queryMemory({ platforms: ["claude"] });
    assert.equal(claude.length, 1);
    assert.equal(claude[0].platform, "claude");

    const codex = queryMemory({ platforms: ["codex"] });
    assert.equal(codex.length, 1);
    assert.equal(codex[0].platform, "codex");
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory filters by agent name (case-insensitive)", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({ ...sampleEntry(), name: "other", content: "other", agentName: "implementer-42" });

    const results = queryMemory({ agentName: "debugger" });
    assert.equal(results.length, 1);
    assert.ok(results[0].agentProvenance.some((p) => p.agent.includes("debugger")));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory filters by memoryType", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({
      ...sampleEntry(),
      name: "decision",
      content: "decision content",
      memoryType: "decision",
    });

    const lessons = queryMemory({ memoryType: "lesson" });
    assert.equal(lessons.length, 1);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory filters by tags (case-insensitive)", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({
      ...sampleEntry(),
      name: "other",
      content: "other",
      tags: ["performance"],
    });

    const results = queryMemory({ tags: ["TIMEOUT"] });
    assert.equal(results.length, 1);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory filters by searchText across name, description, content", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({
      ...sampleEntry(),
      name: "other",
      description: "Unrelated entry",
      content: "something unrelated",
    });

    const results = queryMemory({ searchText: "timeout" });
    assert.equal(results.length, 1);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory respects limit and sorts by updatedAt descending", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory({ ...sampleEntry(), name: "first", content: "aaa" });
    storeMemory({ ...sampleEntry(), name: "second", content: "bbb" });
    storeMemory({ ...sampleEntry(), name: "third", content: "ccc" });

    const limited = queryMemory({ limit: 2 });
    assert.equal(limited.length, 2);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory returns empty array when no match", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    const results = queryMemory({ platforms: ["cursor"] });
    assert.deepEqual(results, []);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("queryMemory empty store returns empty array", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const results = queryMemory({});
    assert.deepEqual(results, []);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── getMemoryStats ───────────────────────────────────────────────────────────

test("getMemoryStats returns expected shape with empty store", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const stats = getMemoryStats();

    assert.equal(stats.totalEntries, 0);
    assert.deepEqual(stats.byPlatform, {});
    assert.deepEqual(stats.byType, {});
    assert.deepEqual(stats.topTags, []);
    assert.deepEqual(stats.agentsInvolved, []);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("getMemoryStats aggregates multiple entries correctly", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({
      name: "perf-decision",
      description: "Performance tuning",
      content: "Use caching",
      agentName: "perf-agent",
      platform: "cursor",
      memoryType: "decision",
      tags: ["performance", "caching"],
    });

    const stats = getMemoryStats();

    assert.equal(stats.totalEntries, 2);
    assert.equal(stats.byPlatform.claude, 1);
    assert.equal(stats.byPlatform.cursor, 1);
    assert.ok(stats.byType.lesson === 1);
    assert.ok(stats.byType.decision === 1);
    assert.ok(stats.topTags.some((t) => t.tag === "timeout" && t.count === 1));
    assert.ok(stats.topTags.some((t) => t.tag === "performance" && t.count === 1));
    assert.ok(stats.agentsInvolved.length >= 2);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── getSupportedPlatforms ────────────────────────────────────────────────────

test("getSupportedPlatforms returns all platforms", () => {
  const platforms = getSupportedPlatforms();

  assert.ok(Array.isArray(platforms));
  assert.ok(platforms.some((p) => p.id === "claude"));
  assert.ok(platforms.some((p) => p.id === "codex"));
  assert.ok(platforms.some((p) => p.id === "gemini"));
  assert.ok(platforms.some((p) => p.id === "cursor"));
  assert.ok(platforms.some((p) => p.id === "other"));
});

test("getSupportedPlatforms returns display names", () => {
  const platforms = getSupportedPlatforms();
  const claude = platforms.find((p) => p.id === "claude");
  assert.equal(claude!.name, "Claude Code");

  const codex = platforms.find((p) => p.id === "codex");
  assert.equal(codex!.name, "Amazon Codex");
});

// ─── getPlatformDisplayName ───────────────────────────────────────────────────

test("getPlatformDisplayName returns correct names", () => {
  assert.equal(getPlatformDisplayName("claude"), "Claude Code");
  assert.equal(getPlatformDisplayName("codex"), "Amazon Codex");
  assert.equal(getPlatformDisplayName("gemini"), "Gemini Code Assist");
  assert.equal(getPlatformDisplayName("cursor"), "Cursor");
  assert.equal(getPlatformDisplayName("other"), "Other");
});

// ─── exportToMarkdown ─────────────────────────────────────────────────────────

test("exportToMarkdown generates valid markdown", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());

    const md = exportToMarkdown();

    assert.ok(md.startsWith("# Cross-Agent Memory Store"));
    assert.ok(md.includes("test-bug-fix"));
    assert.ok(md.includes("Increase timeout to 60s for large payloads"));
    assert.ok(md.includes("**Agents:**"));
    assert.ok(md.includes("Type:"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("exportToMarkdown filters by platform", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({
      ...sampleEntry(),
      name: "gemini-entry",
      content: "gemini content",
      platform: "gemini",
    });

    const md = exportToMarkdown({ platforms: ["claude"] });
    assert.ok(md.includes("test-bug-fix"));
    assert.ok(!md.includes("gemini-entry"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("exportToMarkdown filters by memoryType", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());
    storeMemory({
      ...sampleEntry(),
      name: "decision-entry",
      content: "decision content",
      memoryType: "decision",
    });

    const md = exportToMarkdown({ memoryType: "decision" });
    assert.ok(md.includes("decision-entry"));
    assert.ok(!md.includes("test-bug-fix"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("exportToMarkdown handles empty store", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const md = exportToMarkdown();
    assert.ok(md.includes("Total entries: 0"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── exportToMarkdown ──────────────────────────────────────────────────────

test("exportToMarkdown generates valid markdown output", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());

    const md = exportToMarkdown();

    assert.ok(md.includes("# Cross-Agent Memory Store"));
    assert.ok(md.includes("test-bug-fix"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("exportToMarkdown accepts platform filter", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    storeMemory(sampleEntry());

    const md = exportToMarkdown({ platforms: ["claude"] });
    assert.ok(md.includes("test-bug-fix"));
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

// ─── syncWithPlatform ─────────────────────────────────────────────────────────

test("syncWithPlatform reads platform-specific files", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    // Simulate a platform sync file
    const platformDir = join(tmpDir, ".claude", "cross-agent-memory", "platform-cursor");
    mkdirSync(platformDir, { recursive: true });
    writeFileSync(
      join(platformDir, "entry.json"),
      JSON.stringify({
        id: "cursor-entry",
        name: "cursor-fact",
        description: "From cursor",
        content: "cursor-specific knowledge",
        agentProvenance: [
          { agent: "cursor-agent", platform: "cursor", timestamp: new Date().toISOString() },
        ],
        tags: ["cursor"],
        platform: "cursor",
        memoryType: "fact",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "abc123",
      }),
      "utf-8",
    );

    const result = syncWithPlatform("cursor");

    assert.equal(result.synced, 1);
    assert.equal(result.newEntries, 1);
    assert.equal(result.conflicts, 0);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("syncWithPlatform merges provenance on content hash conflict", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    // Create an entry in the main store
    const entry = storeMemory({
      name: "shared-fact",
      description: "Shared",
      content: "same content",
      agentName: "claude-agent",
    });

    // Create a platform file with same content but different agent
    const platformDir = join(tmpDir, ".claude", "cross-agent-memory", "platform-cursor");
    mkdirSync(platformDir, { recursive: true });
    writeFileSync(
      join(platformDir, "entry.json"),
      JSON.stringify({
        ...entry,
        agentProvenance: [
          { agent: "cursor-agent", platform: "cursor", timestamp: new Date().toISOString() },
        ],
      }),
      "utf-8",
    );

    const result = syncWithPlatform("cursor");

    assert.equal(result.synced, 1);
    assert.equal(result.newEntries, 0);
    assert.equal(result.conflicts, 1);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("syncWithPlatform handles invalid platform files gracefully", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const platformDir = join(tmpDir, ".claude", "cross-agent-memory", "platform-codex");
    mkdirSync(platformDir, { recursive: true });
    writeFileSync(join(platformDir, "invalid.json"), "not json", "utf-8");

    const result = syncWithPlatform("codex");
    assert.equal(result.synced, 0);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});

test("syncWithPlatform with no platform directory returns zero counts", () => {
  const origCwd = tempCwd();
  const tmpDir = process.cwd();
  try {
    const result = syncWithPlatform("gemini");
    assert.equal(result.synced, 0);
    assert.equal(result.newEntries, 0);
    assert.equal(result.conflicts, 0);
  } finally {
    restoreCwd(origCwd, tmpDir);
  }
});
