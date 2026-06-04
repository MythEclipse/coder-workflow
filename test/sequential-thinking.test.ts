import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { SequentialThinkingEngine } from "../src/sequential-thinking.js";

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
    const result = engine.processThought({
      thought: "Revised thought",
      thoughtNumber: 3,
      totalThoughts: 5,
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
      thoughtNumber: 4,
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
    // Sessions are only listed when stateDir has files
    const sessions = SequentialThinkingEngine.listSessions("/tmp/nonexistent-dir-for-test");
    assert.ok(Array.isArray(sessions));
  });
});
