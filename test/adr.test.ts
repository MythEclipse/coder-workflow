import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatADRList,
  generateADRGraph,
  listADRs,
  initADR,
  createADR,
  updateADRStatus,
  getADR,
} from "../src/adr.js";
import type { ADR } from "../src/adr.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-adr-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// ─── formatADRList (pure function) ──────────────────────────────────────

test("formatADRList returns empty message for empty list", () => {
  const output = formatADRList([]);

  assert.equal(output, "No ADRs found. Use 'coder-workflow adr new <title>' to create one.");
});

test("formatADRList formats single ADR entry with all fields", () => {
  const adrs: ADR[] = [
    {
      id: 1,
      title: "Use TypeScript for backend",
      status: "accepted",
      date: "2024-01-15",
      filename: "0001-use-typescript.md",
      content: "# 1. Use TypeScript for backend\n\n**Status:** accepted\n",
    },
  ];

  const output = formatADRList(adrs);

  // The table uses the box-drawing vertical bar character (U+2502)
  assert.match(output, /Use TypeScript for backend/);
  assert.match(output, /accepted/);
  assert.match(output, /2024-01-15/);
  assert.match(output, /Use TypeScript for backend/);
  assert.match(output, /ID/);
  assert.match(output, /^┌──────┬─────/);
  assert.match(output, /└──────┴─────/);
});

test("formatADRList formats all four statuses", () => {
  const adrs: ADR[] = [
    { id: 1, title: "One", status: "accepted", date: "2024-01-01", filename: "0001-one.md", content: "" },
    { id: 2, title: "Two", status: "proposed", date: "2024-02-01", filename: "0002-two.md", content: "" },
    { id: 3, title: "Three", status: "deprecated", date: "2024-03-01", filename: "0003-three.md", content: "" },
    { id: 4, title: "Four", status: "superseded", date: "2024-04-01", filename: "0004-four.md", content: "" },
  ];

  const output = formatADRList(adrs);

  assert.match(output, /accepted/);
  assert.match(output, /proposed/);
  assert.match(output, /deprecated/);
  assert.match(output, /superseded/);
  assert.match(output, /One/);
  assert.match(output, /Four/);
});

test("formatADRList truncates long titles to 46 chars", () => {
  const adrs: ADR[] = [{
    id: 1,
    title: "This is an extremely long title that should definitely be truncated to fit",
    status: "proposed",
    date: "2024-01-01",
    filename: "0001-long.md",
    content: "",
  }];

  const output = formatADRList(adrs);

  // The title cells are padded to 46 chars, so the visible text should be max 46
  for (const line of output.split("\n")) {
    if (line.includes("This is an extremely long")) {
      // Extract the title portion between the first and second box-drawing vertical bar
      const cells = line.split("│");
      assert.ok(cells.length >= 3, `expected at least 3 cells in line: ${line}`);
      const titleCell = cells[2];
      assert.ok(titleCell.trim().length <= 46, `long titles should be truncated to 46 chars, got "${titleCell.trim()}" (${titleCell.trim().length})`);
    }
  }
});

test("formatADRList preserves the array ordering", () => {
  const adrs: ADR[] = [
    { id: 10, title: "Ten", status: "accepted", date: "2024-01-01", filename: "0010-ten.md", content: "" },
    { id: 2, title: "Two", status: "proposed", date: "2024-02-01", filename: "0002-two.md", content: "" },
    { id: 1, title: "One", status: "accepted", date: "2024-03-01", filename: "0001-one.md", content: "" },
  ];

  const output = formatADRList(adrs);

  const tenIdx = output.indexOf(" Ten ");
  const twoIdx = output.indexOf(" Two ");
  const oneIdx = output.indexOf(" One ");

  assert.ok(tenIdx < twoIdx, "ten should appear before two (array order preserved)");
  assert.ok(twoIdx < oneIdx, "two should appear before one (array order preserved)");
});

// ─── ADR file I/O operations (using chdir to temp) ──────────────────────

test("createADR, listADRs, and getADR work end-to-end in a temp directory", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const created = createADR({ title: "Use Monorepo Structure" });
    assert.ok(created);
    assert.equal(created.title, "Use Monorepo Structure");
    assert.equal(created.status, "proposed");
    assert.ok(created.id >= 1);
    assert.ok(created.filename.endsWith(".md"));
    assert.ok(created.date.match(/^\d{4}-\d{2}-\d{2}$/));
    assert.ok(created.content.includes("# "));

    // Verify file was created on disk
    assert.ok(existsSync(join(root, "docs/adr", created.filename)));

    // listADRs should include the created ADR
    const list = listADRs();
    assert.ok(list.length >= 1);
    const found = list.find((a) => a.id === created.id);
    assert.ok(found);
    assert.equal(found.title, "Use Monorepo Structure");

    // getADR returns the specific ADR
    const byGet = getADR(created.id);
    assert.ok(byGet);
    assert.equal(byGet.title, "Use Monorepo Structure");
  } finally {
    process.chdir(origCwd);
  }
});

test("createADR respects custom status and supersedes", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const created = createADR({
      title: "ADR with Custom Status",
      status: "accepted",
      supersedes: 5,
    });

    assert.equal(created.status, "accepted");
    assert.ok(created.content.includes("**Status:** accepted"));
    assert.ok(created.content.includes("ADR-5"));
  } finally {
    process.chdir(origCwd);
  }
});

test("createADR auto-increments IDs", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const first = createADR({ title: "First ADR" });
    const second = createADR({ title: "Second ADR" });

    assert.equal(second.id, first.id + 1);
  } finally {
    process.chdir(origCwd);
  }
});

test("updateADRStatus modifies the status of an ADR", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const created = createADR({ title: "Status Update Test", status: "proposed" });

    const updated = updateADRStatus(created.id, "accepted");
    assert.ok(updated);
    assert.equal(updated.status, "accepted");
    assert.ok(updated.content.includes("**Status:** accepted"));

    // Verify persistence by re-reading
    const reRead = getADR(created.id);
    assert.equal(reRead?.status, "accepted");
  } finally {
    process.chdir(origCwd);
  }
});

test("updateADRStatus returns undefined for nonexistent ADR", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);
    const result = updateADRStatus(999, "accepted");
    assert.equal(result, undefined);
  } finally {
    process.chdir(origCwd);
  }
});

test("getADR returns undefined for nonexistent ID", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);
    const result = getADR(999);
    assert.equal(result, undefined);
  } finally {
    process.chdir(origCwd);
  }
});

test("listADRs returns ADRs sorted by ID", () => {
  const root = fixture({
    "docs/adr/0002-second.md": [
      "# 2. Second ADR",
      "**Status:** accepted",
      "**Date:** 2024-02-01",
    ].join("\n"),
    "docs/adr/0001-first.md": [
      "# 1. First ADR",
      "**Status:** proposed",
      "**Date:** 2024-01-01",
    ].join("\n"),
    "docs/adr/README.md": "# ADR List\n",
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const list = listADRs();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, 1);
    assert.equal(list[1].id, 2);
    assert.equal(list[0].title, "First ADR");
    assert.equal(list[1].title, "Second ADR");
  } finally {
    process.chdir(origCwd);
  }
});

test("listADRs parses content to extract title, status, and date", () => {
  const root = fixture({
    "docs/adr/0001-test.md": [
      "# 1. Custom Parsed ADR",
      "",
      "**Status:** accepted",
      "**Date:** 2024-06-15",
      "**Supersedes:** None",
      "",
      "## Context",
      "Decision context here.",
    ].join("\n"),
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const list = listADRs();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Custom Parsed ADR");
    assert.equal(list[0].status, "accepted");
    assert.equal(list[0].date, "2024-06-15");
  } finally {
    process.chdir(origCwd);
  }
});

test("listADRs handles malformed files gracefully", () => {
  const root = fixture({
    "docs/adr/0001-empty.md": "",
    "docs/adr/0005-normal.md": [
      "# 5. Normal ADR",
      "**Status:** proposed",
      "**Date:** 2024-01-01",
    ].join("\n"),
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const list = listADRs();
    // Empty file should be handled without crashing; the ID is parsed from filename prefix
    assert.ok(list.length >= 1);
    // At minimum the normal ADR should be found
    assert.ok(list.some((a) => a.title.includes("Normal")));
  } finally {
    process.chdir(origCwd);
  }
});

test("initADR creates docs/adr directory with README", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const result = initADR();
    assert.ok(result);
    assert.ok(result.dir.endsWith("docs/adr"));

    // README should exist
    const readmePath = join(root, "docs/adr/README.md");
    assert.ok(existsSync(readmePath));
    const readme = readFileSync(readmePath, "utf-8");
    assert.match(readme, /Architecture Decision Records/);
    assert.match(readme, /coder-workflow adr new/);
    assert.match(readme, /coder-workflow adr list/);
    assert.match(readme, /coder-workflow adr graph/);
  } finally {
    process.chdir(origCwd);
  }
});

test("initADR does not overwrite existing README", () => {
  const root = fixture({
    "docs/adr/README.md": "Custom README content\n",
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    initADR();
    const readme = readFileSync(join(root, "docs/adr/README.md"), "utf-8");
    assert.equal(readme, "Custom README content\n");
  } finally {
    process.chdir(origCwd);
  }
});

test("listADRs returns empty array when docs/adr does not exist", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const list = listADRs();
    assert.deepEqual(list, []);
  } finally {
    process.chdir(origCwd);
  }
});

// ─── generateADRGraph ───────────────────────────────────────────────────

test("generateADRGraph returns 'No ADRs found' when no ADRs exist", () => {
  const root = fixture({});
  const origCwd = process.cwd();

  try {
    process.chdir(root);
    const result = generateADRGraph();
    assert.equal(result, "No ADRs found.");
  } finally {
    process.chdir(origCwd);
  }
});

test("generateADRGraph produces Mermaid graph with nodes and styles", () => {
  const root = fixture({
    "docs/adr/0001-first.md": [
      "# 1. First Decision",
      "**Status:** accepted",
      "**Date:** 2024-01-01",
      "**Supersedes:** None",
    ].join("\n"),
    "docs/adr/0002-second.md": [
      "# 2. Second Decision",
      "**Status:** proposed",
      "**Date:** 2024-02-01",
      "**Supersedes:** None",
    ].join("\n"),
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const result = generateADRGraph();
    assert.match(result, /```mermaid/);
    assert.match(result, /graph LR/);
    assert.match(result, /ADR1/);
    assert.match(result, /ADR2/);
    assert.match(result, /✅/); // accepted icon
    assert.match(result, /💡/); // proposed icon
    assert.match(result, /fill:#d4edda/); // accepted color
    assert.match(result, /fill:#fff3cd/); // proposed color
  } finally {
    process.chdir(origCwd);
  }
});

test("generateADRGraph renders supersedes relationship as dashed arrow", () => {
  const root = fixture({
    "docs/adr/0001-first.md": [
      "# 1. First Decision",
      "**Status:** deprecated",
      "**Date:** 2024-01-01",
      "**Supersedes:** None",
    ].join("\n"),
    "docs/adr/0002-second.md": [
      "# 2. Second Decision",
      "**Status:** accepted",
      "**Date:** 2024-02-01",
      "**Supersedes:** ADR-1",
    ].join("\n"),
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const result = generateADRGraph();
    assert.match(result, /ADR2.*supersedes.*ADR1/);
    assert.match(result, /->\|supersedes\|/);
  } finally {
    process.chdir(origCwd);
  }
});

test("generateADRGraph uses correct status icons and CSS for all statuses", () => {
  const root = fixture({
    "docs/adr/0001-a.md": "# 1. Accepted\n**Status:** accepted\n**Date:** 2024-01-01\n**Supersedes:** None\n",
    "docs/adr/0002-b.md": "# 2. Proposed\n**Status:** proposed\n**Date:** 2024-02-01\n**Supersedes:** None\n",
    "docs/adr/0003-c.md": "# 3. Deprecated\n**Status:** deprecated\n**Date:** 2024-03-01\n**Supersedes:** None\n",
    "docs/adr/0004-d.md": "# 4. Superseded\n**Status:** superseded\n**Date:** 2024-04-01\n**Supersedes:** None\n",
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const result = generateADRGraph();

    // Icons
    assert.match(result, /✅/); // accepted
    assert.match(result, /💡/); // proposed
    assert.match(result, /❌/); // deprecated
    assert.match(result, /➡️/); // superseded

    // CSS fill colors
    assert.match(result, /fill:#d4edda/); // accepted = green
    assert.match(result, /fill:#fff3cd/); // proposed = yellow
    assert.match(result, /fill:#f8d7da/); // deprecated = red
    assert.match(result, /fill:#e2e3e5/); // superseded = gray
  } finally {
    process.chdir(origCwd);
  }
});

test("generateADRGraph truncates long titles to 40 chars in node labels", () => {
  const root = fixture({
    "docs/adr/0001-long.md": [
      "# 1. This is a really long title that should be truncated in the mermaid graph display",
      "**Status:** accepted",
      "**Date:** 2024-01-01",
      "**Supersedes:** None",
    ].join("\n"),
  });
  const origCwd = process.cwd();

  try {
    process.chdir(root);

    const result = generateADRGraph();
    // The graph labels are truncated to 40 chars in the label
    const labelMatch = result.match(/✅ 1: (.+?)"/);
    assert.ok(labelMatch);
    assert.ok(labelMatch[1].length <= 43, "long title should be truncated in graph label"); // 40 + ": " separator
  } finally {
    process.chdir(origCwd);
  }
});
