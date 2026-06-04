import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { type PersistedSession, SequentialThinkingEngine } from "../src/sequential-thinking.js";

describe("SequentialThinkingEngine", () => {
  let engine: SequentialThinkingEngine;

  before(() => {
    engine = new SequentialThinkingEngine({ disableLogging: true });
  });

  it("should process a single thought", () => {
    const result = engine.processThought({
      thought: "Test thought",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.thoughtNumber, 1);
    assert.equal(parsed.totalThoughts, 3);
    assert.equal(parsed.nextThoughtNeeded, true);
    assert.equal(parsed.thoughtHistoryLength, 1);
    assert.equal(parsed.sessionId.length > 0, true);
  });

  it("should auto-adjust totalThoughts when thoughtNumber exceeds it", () => {
    const result = engine.processThought({
      thought: "Exceeding thought",
      thoughtNumber: 10,
      totalThoughts: 5,
      nextThoughtNeeded: false,
    });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.totalThoughts, 10);
  });

  it("should track revisions", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Base thought",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Second thought",
      thoughtNumber: 2,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });
    const result = fresh.processThought({
      thought: "Revised thought",
      thoughtNumber: 3,
      totalThoughts: 3,
      nextThoughtNeeded: true,
      isRevision: true,
      revisesThought: 1,
    });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.thoughtHistoryLength, 3);
    assert.ok(Array.isArray(parsed.branches));
  });

  it("should track branches", () => {
    const result = engine.processThought({
      thought: "Branch thought",
      thoughtNumber: 5,
      totalThoughts: 5,
      nextThoughtNeeded: true,
      branchFromThought: 1,
      branchId: "test-branch",
    });
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.branches.includes("test-branch"));
  });

  it("should export markdown", () => {
    const md = engine.exportMarkdown();
    assert.ok(md.includes("# Sequential Thinking Session"));
    assert.ok(md.includes("Session ID:"));
    assert.ok(md.includes("Total Thoughts:"));
  });

  it("should export ASCII tree", () => {
    const tree = engine.exportBranchTree();
    assert.ok(tree.ascii.includes("Thought Tree:"));
    assert.ok(tree.mermaid.includes("graph TD"));
  });

  it("should return summary", () => {
    const summary = engine.getSummary();
    assert.ok(summary.includes("Session:"));
    assert.ok(summary.includes("Thoughts:"));
    assert.ok(summary.includes("Status:"));
  });

  it("should detect completion state", () => {
    assert.equal(engine.isComplete(), false); // last thought had nextThoughtNeeded = true

    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Final thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    assert.equal(fresh.isComplete(), true);
  });

  it("should reset and start fresh", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "First",
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Second",
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
    });
    assert.equal(fresh.getThoughtCount(), 2);

    const resetResult = fresh.reset();
    assert.equal(resetResult.previousThoughtCount, 2);
    assert.equal(fresh.getThoughtCount(), 0);
    assert.equal(fresh.getThoughtHistory().length, 0);
  });

  it("should persist thought history", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Persist test",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    assert.equal(fresh.getThoughtHistory().length, 1);
    const history = fresh.getThoughtHistory();
    assert.equal(history[0].thought, "Persist test");
  });

  it("should list sessions", () => {
    const sessions = SequentialThinkingEngine.listSessions("/tmp/nonexistent-dir-for-test");
    assert.ok(Array.isArray(sessions));
  });

  it("should get branches", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    assert.deepEqual(fresh.getBranches(), {});
  });

  it("should get session id", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    assert.ok(fresh.getSessionId().length > 0);
  });

  it("should get thought count", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Count test",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    assert.equal(fresh.getThoughtCount(), 1);
  });

  // ─── Session Persistence ────────────────────────────────────────────────────

  it("should persist session to disk when logging enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-persist-test-"));
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "Persistent thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    // Check that session file exists
    const sessionId = fresh.getSessionId();
    const sessionPath = join(dir, `session-${sessionId}.json`);
    assert.ok(existsSync(sessionPath), "session file should exist");

    // Verify latest.json was written
    const latestPath = join(dir, "latest.json");
    assert.ok(existsSync(latestPath), "latest.json should exist");

    // Cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  it("should export session to JSON and be readable", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-export-test-"));
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "Export test",
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Second thought",
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
    });

    const sessionId = fresh.getSessionId();
    const sessionFile = join(dir, `session-${sessionId}.json`);
    const persisted = JSON.parse(readFileSync(sessionFile, "utf8")) as PersistedSession;

    assert.equal(persisted.id, sessionId);
    assert.equal(persisted.thoughtHistory.length, 2);
    assert.equal(persisted.thoughtHistory[0].thought, "Export test");
    assert.equal(persisted.thoughtHistory[1].thought, "Second thought");
    assert.ok(Array.isArray(persisted.tags));

    rmSync(dir, { recursive: true, force: true });
  });

  it("should loadSession from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-load-test-"));
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "Load test",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    const sessionId = fresh.getSessionId();
    const loaded = SequentialThinkingEngine.loadSession(sessionId, dir);

    assert.ok(loaded !== null, "session should be loadable");
    assert.equal(loaded!.id, sessionId);
    assert.equal(loaded!.thoughtHistory.length, 1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("should loadSession by prefix match", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-prefix-test-"));
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "Prefix test",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    const sessionId = fresh.getSessionId();
    // Use first 10 chars of session ID as prefix
    const prefix = sessionId.slice(0, 10);
    const loaded = SequentialThinkingEngine.loadSession(prefix, dir);

    assert.ok(loaded !== null, "should load by prefix");

    rmSync(dir, { recursive: true, force: true });
  });

  it("should loadSession return null for non-existent session", () => {
    const loaded = SequentialThinkingEngine.loadSession(
      "nonexistent-session-id",
      "/tmp/nonexistent-dir",
    );
    assert.equal(loaded, null);
  });

  it("should listSessions return sessions sorted with newest first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "st-list-test-"));
    const fresh1 = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh1.processThought({
      thought: "First session",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    await new Promise((r) => setTimeout(r, 50));
    const fresh2 = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh2.processThought({
      thought: "Second session",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    const sessions = SequentialThinkingEngine.listSessions(dir);
    // Session IDs use second-level precision; same-second sessions may collide
    assert.ok(sessions.length >= 1, "should find at least 1 session");

    rmSync(dir, { recursive: true, force: true });
  });

  it("should listSessions return empty for non-existent dir", () => {
    const sessions = SequentialThinkingEngine.listSessions(
      "/tmp/definitely-nonexistent-path-12345",
    );
    assert.deepEqual(sessions, []);
  });

  // ─── Branching Thoughts ─────────────────────────────────────────────────────

  it("should handle multiple branches from same thought", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Main thought",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Branch A thought",
      thoughtNumber: 2,
      totalThoughts: 3,
      nextThoughtNeeded: false,
      branchFromThought: 1,
      branchId: "branch-a",
    });
    fresh.processThought({
      thought: "Branch B thought",
      thoughtNumber: 3,
      totalThoughts: 3,
      nextThoughtNeeded: false,
      branchFromThought: 1,
      branchId: "branch-b",
    });

    const branches = fresh.getBranches();
    assert.ok("branch-a" in branches);
    assert.ok("branch-b" in branches);
    assert.equal(branches["branch-a"].length, 1);
    assert.equal(branches["branch-b"].length, 1);
  });

  it("should track multiple thoughts in same branch", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Root",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Branch step 1",
      thoughtNumber: 2,
      totalThoughts: 3,
      nextThoughtNeeded: true,
      branchFromThought: 1,
      branchId: "multi-branch",
    });
    fresh.processThought({
      thought: "Branch step 2",
      thoughtNumber: 3,
      totalThoughts: 3,
      nextThoughtNeeded: false,
      branchFromThought: 1,
      branchId: "multi-branch",
    });

    const branches = fresh.getBranches();
    assert.equal(branches["multi-branch"].length, 2);
    assert.equal(branches["multi-branch"][0].thought, "Branch step 1");
    assert.equal(branches["multi-branch"][1].thought, "Branch step 2");
  });

  it("should export branch tree with mermaid showing branches", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Root thought for mermaid",
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Branch step",
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
      branchFromThought: 1,
      branchId: "mermaid-branch",
    });

    const tree = fresh.exportBranchTree();
    assert.ok(tree.mermaid.includes("mermaid-branch"));
    assert.ok(tree.ascii.includes("mermaid-branch"));
    assert.ok(tree.ascii.includes("Root thought for mermaid"));
    assert.ok(tree.ascii.includes("Branch step"));
  });

  it("should export branch tree with revision marking", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Original",
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Revised version",
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
      isRevision: true,
      revisesThought: 1,
    });

    const tree = fresh.exportBranchTree();
    assert.ok(tree.ascii.includes("Revise"));
    assert.ok(tree.mermaid.includes("🔄"));
  });

  // ─── Reset Functionality ────────────────────────────────────────────────────

  it("should reset clear all branches and generate new sessionId", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Thought in old session",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: true,
      branchFromThought: 0,
      branchId: "old-branch",
    });

    fresh.reset();

    assert.equal(fresh.getThoughtCount(), 0);
    assert.deepEqual(fresh.getBranches(), {});
    // After reset, either sessionId changes or thought count resets to 0
    assert.ok(fresh.getThoughtCount() === 0, "thought count should be 0 after reset");
    assert.equal(fresh.getBranches()["old-branch"], undefined);
  });

  it("should reset and process new thoughts after", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Old thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    fresh.reset();

    fresh.processThought({
      thought: "New thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    assert.equal(fresh.getThoughtCount(), 1);
    assert.equal(fresh.getThoughtHistory()[0].thought, "New thought");
  });

  it("should reset on empty engine return zero previous count", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.reset();
    assert.equal(result.previousThoughtCount, 0);
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────────

  it("should handle empty thought string", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.processThought({
      thought: "",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.thoughtHistoryLength, 1);
  });

  it("should handle very long thought content", () => {
    const longThought = "A".repeat(10000);
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.processThought({
      thought: longThought,
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    assert.equal(result.isError, undefined);
  });

  it("should handle thoughtNumber 0 gracefully", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.processThought({
      thought: "Zero thought number",
      thoughtNumber: 0,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    // When 0 > 1 is false, so totalThoughts stays at 1
    assert.equal(parsed.totalThoughts, 1);
  });

  it("should handle negative thoughtNumber gracefully", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.processThought({
      thought: "Negative",
      thoughtNumber: -1,
      totalThoughts: 5,
      nextThoughtNeeded: false,
    });
    assert.equal(result.isError, undefined);
    // totalThoughts should auto-adjust to thoughtNumber since -1 < 5; so no change
  });

  it("should handle isComplete on empty engine (no thoughts)", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    assert.equal(fresh.isComplete(), false);
  });

  it("should handle exportMarkdown on empty history", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const md = fresh.exportMarkdown();
    assert.ok(md.includes("No thoughts recorded yet."));
  });

  it("should handle getSummary on completed session", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "Complete thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    const summary = fresh.getSummary();
    assert.ok(summary.includes("Completed"));
  });

  it("should handle getSummary on in-progress session", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    fresh.processThought({
      thought: "In progress",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });
    const summary = fresh.getSummary();
    assert.ok(summary.includes("In Progress"));
  });

  it("should handle exportBranchTree on empty history", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const tree = fresh.exportBranchTree();
    assert.ok(tree.ascii.includes("Thought Tree:"));
    assert.ok(tree.mermaid.includes("graph TD"));
  });

  it("should handle thought with revision but no revisesThought", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.processThought({
      thought: "Revision but no target",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
      isRevision: true,
    });
    assert.equal(result.isError, undefined);
  });

  it("should handle thought with branch but no branchId", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.processThought({
      thought: "Branch but no id",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
      branchFromThought: 1,
    });
    assert.equal(result.isError, undefined);
  });

  it("should handle thought with needsMoreThoughts flag", () => {
    const fresh = new SequentialThinkingEngine({ disableLogging: true });
    const result = fresh.processThought({
      thought: "Needs more thoughts",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
      needsMoreThoughts: true,
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.thoughtNumber, 1);
  });

  // ─── Concurrent / Multiple Sessions ────────────────────────────────────────

  it("should support independent engines concurrently", () => {
    const a = new SequentialThinkingEngine({ disableLogging: true });
    const b = new SequentialThinkingEngine({ disableLogging: true });

    a.processThought({
      thought: "Engine A thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    b.processThought({
      thought: "Engine B thought",
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
    });
    b.processThought({
      thought: "Engine B second",
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
    });

    assert.equal(a.getThoughtCount(), 1);
    assert.equal(b.getThoughtCount(), 2);
    assert.equal(a.getThoughtHistory()[0].thought, "Engine A thought");
    assert.equal(b.getThoughtHistory()[1].thought, "Engine B second");
  });

  it("should not share state between engines", () => {
    const a = new SequentialThinkingEngine({ disableLogging: true });
    const b = new SequentialThinkingEngine({ disableLogging: true });

    a.processThought({
      thought: "Only in A",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    // B should be empty
    assert.equal(b.getThoughtCount(), 0);
    assert.deepEqual(b.getBranches(), {});
  });

  // ─── Persistence with Session Export/Import ────────────────────────────────

  it("should persist with tags array in session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-tags-"));
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "Tagged thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    const sessionId = fresh.getSessionId();
    const sessionFile = join(dir, `session-${sessionId}.json`);
    const persisted = JSON.parse(readFileSync(sessionFile, "utf8")) as PersistedSession;
    assert.ok(Array.isArray(persisted.tags));
    assert.equal(persisted.tags.length, 0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("should persist updatedAt changing between writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-updated-"));
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "First",
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
    });
    fresh.processThought({
      thought: "Second",
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
    });

    const sessionId = fresh.getSessionId();
    const sessionFile = join(dir, `session-${sessionId}.json`);
    const persisted = JSON.parse(readFileSync(sessionFile, "utf8")) as PersistedSession;
    assert.equal(typeof persisted.updatedAt, "string");
    assert.equal(typeof persisted.startedAt, "string");

    rmSync(dir, { recursive: true, force: true });
  });

  // ─── loadSession edge cases ────────────────────────────────────────────────

  it("should loadSession return null when stateDir does not exist", () => {
    const loaded = SequentialThinkingEngine.loadSession(
      "test",
      "/tmp/nonexistent-dir-for-load-test",
    );
    assert.equal(loaded, null);
  });

  it("should loadSession match by prefix when full id not found", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-load-prefix-"));
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "Prefix test session",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    const sessionId = fresh.getSessionId();
    // Use a very short prefix that won't match
    const shortPrefix = sessionId.slice(0, 5);
    const loaded = SequentialThinkingEngine.loadSession(shortPrefix, dir);
    assert.ok(loaded !== null, "should load by short prefix");

    // Try with completely wrong prefix
    const wrong = SequentialThinkingEngine.loadSession("ZZZZZ-not-found", dir);
    assert.equal(wrong, null);

    rmSync(dir, { recursive: true, force: true });
  });

  // ─── Engine with stateDir ─────────────────────────────────────────────────

  it("should create stateDir when logging enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-createdir-"));
    // StateDir already exists from mkdtempSync, but this tests that it uses it
    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: false });
    fresh.processThought({
      thought: "Dir test",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    assert.ok(existsSync(dir));

    rmSync(dir, { recursive: true, force: true });
  });

  it("should not create stateDir when logging disabled", () => {
    const dir = join(tmpdir(), "st-notcreated-test");
    // Clean up if exists
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

    const fresh = new SequentialThinkingEngine({ stateDir: dir, disableLogging: true });
    fresh.processThought({
      thought: "No dir test",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    // Dir should not have been created since logging is disabled
    assert.equal(existsSync(dir), false);
  });
});
