import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function read(rel) {
  return readFile(join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// plugin.json
// ---------------------------------------------------------------------------
test("plugin manifest advertises orchestrator-driven coding workflow", async () => {
  const manifest = await read(".claude-plugin/plugin.json");
  const plugin = JSON.parse(manifest);

  assert.match(plugin.description, /orchestrator/i);
  assert.match(plugin.description, /task decomposition/i);
  assert.match(plugin.description, /coding/i);
  assert.ok(plugin.keywords.includes("orchestrator"));
  assert.ok(plugin.keywords.includes("task-decomposition"));
  assert.ok(plugin.keywords.includes("skill-routing"));
  assert.ok(plugin.keywords.includes("mcp-first"));
});

// ---------------------------------------------------------------------------
// coder-orchestrator
// ---------------------------------------------------------------------------
test("coder-orchestrator enforces skill-first invocation", async () => {
  const skill = await read("skills/coder-orchestrator/SKILL.md");

  assert.match(skill, /invoke relevant skills BEFORE/i);
  assert.match(skill, /1% chance/i);
  assert.match(skill, /codegraph-orchestrator/i);
  assert.match(skill, /graph before grep/i);
  assert.match(skill, /graph before find/i);
  assert.match(skill, /Explore.*FORBIDDEN|FORBIDDEN.*Explore/i);
  assert.match(skill, /codegraph MCP/i);
  assert.match(skill, /tasks before tools/i);
  assert.match(skill, /skills before guesses/i);
});

test("coder-orchestrator defines routing matrix", async () => {
  const skill = await read("skills/coder-orchestrator/SKILL.md");

  assert.match(skill, /coder/i);
  assert.match(skill, /auditor/i);
  assert.match(skill, /refraktor/i);
  assert.match(skill, /deploy-docker/i);
  assert.match(skill, /workflow-planner/i);
  assert.match(skill, /architecture-auditor/i);
  assert.match(skill, /code-implementer/i);
});

test("coder-orchestrator mandates bug discovery and tracking", async () => {
  const skill = await read("skills/coder-orchestrator/SKILL.md");

  assert.match(skill, /fix every discovered bug/i);
  assert.match(skill, /Bug Fix Phase/i);
  assert.match(skill, /not related to my changes/i); // must forbid this phrase
});

// ---------------------------------------------------------------------------
// coder
// ---------------------------------------------------------------------------
test("coder skill defines disciplined implementation workflow", async () => {
  const skill = await read("skills/coder/SKILL.md");

  assert.match(skill, /TaskCreate/i);
  assert.match(skill, /TaskUpdate/i);
  assert.match(skill, /in_progress/i);
  assert.match(skill, /completed/i);
  assert.match(skill, /context7/i);
  assert.match(skill, /codegraph MCP/i);
  assert.match(skill, /Bug Fix Phase/i);
  assert.match(skill, /not related to my changes/i); // forbidden phrase
  assert.match(skill, /plan mode/i);
});

test("coder skill references workflow checklist", async () => {
  const skill = await read("skills/coder/SKILL.md");
  assert.match(skill, /references\/workflow-checklist\.md/i);
});

// ---------------------------------------------------------------------------
// auditor
// ---------------------------------------------------------------------------
test("auditor skill defines read-only audit workflow", async () => {
  const skill = await read("skills/auditor/SKILL.md");

  assert.match(skill, /read-only audit/i);
  assert.match(skill, /fat controller/i);
  assert.match(skill, /layer violation/i);
  assert.match(skill, /refactor risk/i);
  assert.match(skill, /scope/i);
  assert.match(skill, /severity/i);
  assert.match(skill, /High.*Medium.*Low|severity.*guide/i);
  assert.match(skill, /references\/audit-checklist\.md/i);
});

test("auditor skill enforces scope confirmation before violation scanning", async () => {
  const skill = await read("skills/auditor/SKILL.md");

  assert.match(skill, /confirm the scope/i);
  assert.match(skill, /Do not proceed to violation scanning until the scope is confirmed/i);
});

// ---------------------------------------------------------------------------
// refraktor
// ---------------------------------------------------------------------------
test("refraktor skill defines multi-language Modular MVC refactor", async () => {
  const skill = await read("skills/refraktor/SKILL.md");

  assert.match(skill, /Modular MVC \+ Service \+ Repository/i);
  assert.match(skill, /EnterPlanMode/i);
  assert.match(skill, /language-agnostic|TypeScript.*Python.*Go.*Rust|any language/i);
  assert.match(skill, /stack detection/i);
  assert.match(skill, /migration manifest/i);
  assert.match(skill, /HARD GATE.*planning is mandatory|planning.*mandatory/i);
  assert.match(skill, /Route.*Controller.*Service.*Repository/i);
});

test("refraktor skill defines safety rules", async () => {
  const skill = await read("skills/refraktor/SKILL.md");

  assert.match(skill, /Plan first/i);
  assert.match(skill, /Preserve behavior/i);
  assert.match(skill, /git reset/i); // must forbid mass reset
  assert.match(skill, /ts-ignore/i); // must forbid suppression flags
  assert.match(skill, /small batches/i);
});

test("refraktor skill references layer contract", async () => {
  const skill = await read("skills/refraktor/SKILL.md");
  assert.match(skill, /references\/layer-contract\.md/i);
});

// ---------------------------------------------------------------------------
// deploy-docker
// ---------------------------------------------------------------------------
test("deploy-docker skill covers Docker, GHCR, VPS, Traefik", async () => {
  const skill = await read("skills/deploy-docker/SKILL.md");

  assert.match(skill, /Dockerfile/i);
  assert.match(skill, /GitHub Actions/i);
  assert.match(skill, /GHCR/i);
  assert.match(skill, /Traefik/i);
  assert.match(skill, /Docker Compose/i);
  assert.match(skill, /VPS/i);
  assert.match(skill, /404/i);
  assert.match(skill, /502/i);
});

// ---------------------------------------------------------------------------
// batch-codegraph must NOT exist (moved to codegraph-mapper)
// ---------------------------------------------------------------------------
test("batch-codegraph skill does NOT exist in coder-workflow", async () => {
  await assert.rejects(
    read("skills/batch-codegraph/SKILL.md"),
    { code: "ENOENT" },
    "batch-codegraph should have been removed from coder-workflow (canonical is in codegraph-mapper)",
  );
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
test("workflow-planner agent defines aggressive decomposition", async () => {
  const agent = await read("agents/workflow-planner.md");

  assert.match(agent, /decompos/i);
  assert.match(agent, /task/i);
  assert.match(agent, /dependency/i);
});

test("architecture-auditor agent defines read-only audit", async () => {
  const agent = await read("agents/architecture-auditor.md");

  assert.match(agent, /audit/i);
  assert.match(agent, /layer/i);
});

test("code-implementer agent defines scoped implementation", async () => {
  const agent = await read("agents/code-implementer.md");

  assert.match(agent, /implement/i);
  assert.match(agent, /spec/i);
  assert.match(agent, /review/i);
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
test("coder-workflow command defines orchestrator trigger", async () => {
  const cmd = await read("commands/coder-workflow.md");

  assert.match(cmd, /coder-orchestrator/i);
  assert.match(cmd, /workflow-planner/i);
  assert.match(cmd, /architecture-auditor/i);
  assert.match(cmd, /code-implementer/i);
  assert.match(cmd, /Bug Fix Phase/i);
});

test("audit command defines architecture audit entry point", async () => {
  const cmd = await read("commands/audit.md");

  assert.match(cmd, /audit/i);
  assert.match(cmd, /auditor/i);
});

test("plan command defines planning entry point", async () => {
  const cmd = await read("commands/plan.md");

  assert.match(cmd, /plan/i);
  assert.match(cmd, /workflow-planner/i);
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
test("hooks.json defines SessionStart, PostToolUse, and Stop", async () => {
  const hooks = JSON.parse(await read("hooks/hooks.json"));

  assert.ok(hooks.hooks.SessionStart, "SessionStart hook missing");
  assert.ok(hooks.hooks.PostToolUse, "PostToolUse hook missing");
  assert.ok(hooks.hooks.Stop, "Stop hook missing");
});
