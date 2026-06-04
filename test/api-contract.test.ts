import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compareOpenApiSpecs,
  formatContractReport,
} from "../src/api-contract.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "api-contract-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("formatContractReport shows breaking status when breaking changes exist", () => {
  const report = {
    breaking: true,
    changes: [
      {
        type: "endpoint-removed" as const,
        path: "/users/:id",
        method: "delete",
        detail: "Endpoint DELETE /users/:id was removed",
      },
    ],
    endpointsBefore: 2,
    endpointsAfter: 1,
  };
  const output = formatContractReport(report);
  assert.match(output, /BREAKING CHANGES DETECTED/);
  assert.match(output, /2 → 1/);
  assert.match(output, /DELETE.*\/users\/:id/);
});

test("formatContractReport shows success for non-breaking additions", () => {
  const report = {
    breaking: false,
    changes: [
      {
        type: "endpoint-added" as const,
        path: "/health",
        method: "get",
        detail: "Endpoint GET /health was added",
      },
    ],
    endpointsBefore: 3,
    endpointsAfter: 4,
  };
  const output = formatContractReport(report);
  assert.match(output, /No breaking changes/);
  assert.match(output, /3 → 4/);
  assert.match(output, /\+33\.3%/);
});

test("formatContractReport shows no changes message when changes list is empty", () => {
  const report = {
    breaking: false,
    changes: [],
    endpointsBefore: 5,
    endpointsAfter: 5,
  };
  const output = formatContractReport(report);
  assert.match(output, /No breaking changes/);
  assert.match(output, /No changes detected/);
});

test("formatContractReport handles zero endpoints before", () => {
  const report = {
    breaking: false,
    changes: [
      {
        type: "endpoint-added" as const,
        path: "/health",
        method: "get",
        detail: "Endpoint GET /health was added",
      },
    ],
    endpointsBefore: 0,
    endpointsAfter: 1,
  };
  const output = formatContractReport(report);
  assert.match(output, /0 → 1/);
  // With 0 endpoints before, percentage is skipped
  assert.doesNotMatch(output, /Endpoint change:/);
});

test("compareOpenApiSpecs detects added and removed endpoints from JSON specs", () => {
  const root = fixture({
    "before.json": JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/users": {
          get: {
            parameters: [{ name: "page", in: "query", required: false }],
            responses: { "200": { description: "List users" } },
          },
        },
        "/users/:id": {
          delete: { responses: { "200": { description: "Delete user" } } },
        },
      },
    }),
    "after.json": JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/users": {
          get: { responses: { "200": { description: "List users" } } },
        },
        "/health": {
          get: { responses: { "200": { description: "Health check" } } },
        },
      },
    }),
  });

  const report = compareOpenApiSpecs(
    join(root, "before.json"),
    join(root, "after.json"),
  );

  assert.ok(report.breaking);
  assert.equal(report.endpointsBefore, 2);
  assert.equal(report.endpointsAfter, 2);

  const removed = report.changes.filter((c) => c.type === "endpoint-removed");
  const added = report.changes.filter((c) => c.type === "endpoint-added");
  const paramRemoved = report.changes.filter((c) => c.type === "param-removed");

  assert.equal(removed.length, 1);
  assert.equal(removed[0].path, "/users/:id");

  assert.equal(added.length, 1);
  assert.equal(added[0].path, "/health");

  // The page param was removed
  assert.equal(paramRemoved.length, 1);
  assert.match(paramRemoved[0].detail, /page/);
});

test("compareOpenApiSpecs reports identical specs as non-breaking", () => {
  const spec = JSON.stringify({
    openapi: "3.0.0",
    paths: {
      "/ping": {
        get: { responses: { "200": { description: "pong" } } },
      },
    },
  });
  const root = fixture({
    "before.json": spec,
    "after.json": spec,
  });

  const report = compareOpenApiSpecs(
    join(root, "before.json"),
    join(root, "after.json"),
  );
  assert.equal(report.breaking, false);
  assert.equal(report.changes.length, 0);
});

test("compareOpenApiSpecs handles empty paths in both specs", () => {
  const root = fixture({
    "a.json": JSON.stringify({ openapi: "3.0.0", paths: {} }),
    "b.json": JSON.stringify({ openapi: "3.0.0", paths: {} }),
  });

  const report = compareOpenApiSpecs(
    join(root, "a.json"),
    join(root, "b.json"),
  );
  assert.equal(report.breaking, false);
  assert.equal(report.changes.length, 0);
  assert.equal(report.endpointsBefore, 0);
  assert.equal(report.endpointsAfter, 0);
});

test("compareOpenApiSpecs throws on missing spec file", () => {
  assert.throws(
    () => {
      compareOpenApiSpecs(
        "/nonexistent/path/before.json",
        "/nonexistent/path/after.json",
      );
    },
    /Spec file not found/,
  );
});

test("compareOpenApiSpecs throws on empty spec file", () => {
  const root = fixture({
    "empty.json": "",
    "other.json": JSON.stringify({ openapi: "3.0.0", paths: {} }),
  });

  assert.throws(
    () => {
      compareOpenApiSpecs(
        join(root, "empty.json"),
        join(root, "other.json"),
      );
    },
    /empty/,
  );
});

test("compareOpenApiSpecs parses basic YAML specs", () => {
  const root = fixture({
    "before.yaml": `openapi: "3.0.0"
info:
  title: Test API
  version: "1.0"
paths:
  /users:
    get:
      responses:
        "200":
          description: List users
`,
    "after.yaml": `openapi: "3.0.0"
info:
  title: Test API
  version: "2.0"
paths:
  /users:
    get:
      responses:
        "200":
          description: List users
  /health:
    get:
      responses:
        "200":
          description: Health check
`,
  });

  const report = compareOpenApiSpecs(
    join(root, "before.yaml"),
    join(root, "after.yaml"),
  );
  assert.equal(report.endpointsBefore, 1);
  assert.equal(report.endpointsAfter, 2);

  const added = report.changes.filter((c) => c.type === "endpoint-added");
  assert.equal(added.length, 1);
  assert.equal(added[0].path, "/health");
});

test("formatContractReport lists multiple change types in summary", () => {
  const report = {
    breaking: true,
    changes: [
      {
        type: "endpoint-removed" as const,
        path: "/old",
        method: "get",
        detail: "removed",
      },
      {
        type: "endpoint-added" as const,
        path: "/new",
        method: "post",
        detail: "added",
      },
      {
        type: "response-changed" as const,
        path: "/users",
        method: "get",
        detail: "Response 200 schema changed",
      },
    ],
    endpointsBefore: 5,
    endpointsAfter: 5,
  };
  const output = formatContractReport(report);
  assert.match(output, /Endpoint Removed.*1/);
  assert.match(output, /Endpoint Added.*1/);
  assert.match(output, /Response Changed.*1/);
});
