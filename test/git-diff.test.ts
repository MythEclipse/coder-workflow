import assert from "node:assert/strict";
import test from "node:test";
import { diffGraphs, formatGraphDiff } from "../src/git-diff.js";

test("diffGraphs reports added and removed nodes and edges", () => {
  const before = {
    version: "0.1.0" as const,
    generatedAt: new Date().toISOString(),
    root: "/test",
    nodes: [{ id: "file:a.ts", type: "file" as const, name: "a.ts", path: "a.ts" }],
    edges: [],
    metadata: {
      filesScanned: 1,
      nodesCount: 1,
      edgesCount: 0,
      languages: ["typescript"],
      ignoredPaths: [],
      nodeTypes: {},
      edgeTypes: {},
      relationshipCoverage: 1,
      qualityScore: 1,
    },
  };
  const after = {
    version: "0.1.0" as const,
    generatedAt: new Date().toISOString(),
    root: "/test",
    nodes: [
      { id: "file:a.ts", type: "file" as const, name: "a.ts", path: "a.ts" },
      { id: "file:b.ts", type: "file" as const, name: "b.ts", path: "b.ts" },
    ],
    edges: [
      {
        id: "depends-on:file:a.ts->file:b.ts",
        type: "depends-on" as const,
        source: "file:a.ts",
        target: "file:b.ts",
      },
    ],
    metadata: {
      filesScanned: 2,
      nodesCount: 2,
      edgesCount: 1,
      languages: ["typescript"],
      ignoredPaths: [],
      nodeTypes: {},
      edgeTypes: {},
      relationshipCoverage: 1,
      qualityScore: 1,
    },
  };

  const diff = diffGraphs(before, after);
  assert.deepEqual(
    diff.addedNodes.map((node) => node.id),
    ["file:b.ts"],
  );
  assert.deepEqual(
    diff.addedEdges.map((edge) => edge.id),
    ["depends-on:file:a.ts->file:b.ts"],
  );
});

test("formatGraphDiff returns markdown summary", () => {
  const markdown = formatGraphDiff({
    addedNodes: [],
    removedNodes: [],
    addedEdges: [],
    removedEdges: [],
    risk: "low",
  });
  assert.match(markdown, /## Graph Diff/);
  assert.match(markdown, /Risk: low/);
});
