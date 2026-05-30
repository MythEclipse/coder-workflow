import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function read(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("query-codegraph advertises MCP-first broad codebase search triggers", async () => {
  const skill = await read("skills/query-codegraph/SKILL.md");

  assert.match(skill, /codebase search/i);
  assert.match(skill, /explor/i);
  assert.match(skill, /where .*implemented/i);
  assert.match(skill, /Trigger even when the user does not mention CodeGraph or MCP/i);
  assert.match(skill, /before .*grep/i);
  assert.match(skill, /before .*find/i);
  assert.match(skill, /before .*Explore agents/i);
  assert.match(skill, /exact literal text search/i);
});

test("analyze-codegraph advertises MCP-first architecture and impact triggers", async () => {
  const skill = await read("skills/analyze-codegraph/SKILL.md");

  assert.match(skill, /architecture/i);
  assert.match(skill, /impact/i);
  assert.match(skill, /dependency risk/i);
  assert.match(skill, /hotspot/i);
  assert.match(skill, /files.*inspect|inspect.*files/i);
  assert.match(skill, /Trigger even when the user does not mention CodeGraph or MCP/i);
  assert.match(skill, /before .*grep/i);
  assert.match(skill, /exact literal text search/i);
});

test("scan-codegraph advertises graph refresh before broad exploration", async () => {
  const skill = await read("skills/scan-codegraph/SKILL.md");

  assert.match(skill, /broad codebase exploration/i);
  assert.match(skill, /understand this repo/i);
  assert.match(skill, /map project structure/i);
  assert.match(skill, /project-structure mapping/i);
  assert.match(skill, /explore where logic lives/i);
  assert.match(skill, /search the codebase for request handling/i);
  assert.match(skill, /missing or stale/i);
  assert.match(skill, /exact literal text searches/i);
});

test("coder-orchestrator includes codebase exploration and benchmark routing", async () => {
  const skill = await read("skills/coder-orchestrator/SKILL.md");

  assert.match(skill, /graph before grep/i);
  assert.match(skill, /graph before find/i);
  assert.match(skill, /graph before Explore agents/i);
  assert.match(skill, /scan-codegraph/i);
  assert.match(skill, /query-codegraph/i);
  assert.match(skill, /analyze-codegraph/i);
  assert.match(skill, /first exploration|graph before grep/i);
  assert.match(skill, /summarize_architecture/i);
  assert.match(skill, /summarize_graph/i);
  assert.match(skill, /analyze_quality/i);
  assert.match(skill, /exact literal text search/i);
});

test("plugin manifest advertises graph-first automatic codebase understanding", async () => {
  const manifest = await read(".claude-plugin/plugin.json");
  const plugin = JSON.parse(manifest) as { description: string; keywords: string[] };

  assert.match(plugin.description, /graph-first/i);
  assert.match(plugin.description, /before broad grep\/search/i);
  assert.match(plugin.description, /orchestrator-driven routing/i);
  assert.match(plugin.description, /codebase/i);
  assert.ok(plugin.keywords.includes("code-search"));
  assert.ok(plugin.keywords.includes("codebase-understanding"));
  assert.ok(plugin.keywords.includes("orchestrator"));
  assert.ok(plugin.keywords.includes("codegraph-first"));
});

test("refraktor command defines safe refactor workflow", async () => {
  const command = await read("commands/refraktor.md");

  assert.match(
    command,
    /^---[\s\S]*description:\s*Refactor codebase ke arsitektur Modular MVC \+ Service \+ Repository[\s\S]*---/i,
  );
  assert.match(command, /allowed-tools:/i);
  assert.match(command, /argument-hint:\s*\[scope-optional\]/i);
  assert.match(command, /tanpa\s+mengubah perilaku fungsional/i);
  assert.match(command, /hapus massal tanpa persetujuan eksplisit/i);
  assert.match(command, /Jangan ubah API publik \/ kontrak eksternal tanpa konfirmasi/i);
});
