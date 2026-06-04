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
  assert.ok(plugin.keywords.includes("codegraph-first") || plugin.keywords.includes("codegraph"));
});

// ---------------------------------------------------------------------------
// coder-orchestrator
// ---------------------------------------------------------------------------
test("coder-orchestrator enforces subagent invocation", async () => {
  const skill = await read("skills/coder-orchestrator/SKILL.md");

  assert.match(skill, /subagent/i);
  assert.match(skill, /1% chance/i);
  assert.match(skill, /MCP|codegraph/i);
});

test("coder-orchestrator defines routing matrix", async () => {
  const skill = await read("skills/coder-orchestrator/SKILL.md");

  assert.match(skill, /workflow-planner/i);
  assert.match(skill, /architecture-auditor/i);
  assert.match(skill, /code-implementer/i);
  assert.match(skill, /test-engineer/i);
  assert.match(skill, /Impact Radius/i);
  assert.match(skill, /deploy/i);
  assert.match(skill, /audit/i);
  assert.match(skill, /bug fix phase/i);
});

test("coder-orchestrator defines Workflow Sequence", async () => {
  const skill = await read("skills/coder-orchestrator/SKILL.md");

  assert.match(skill, /Swarm Dispatch/i);
  assert.match(skill, /Synthesis.*Conflict/i);
  assert.match(skill, /Bug Fix Phase/i);
  assert.match(skill, /FILE_MANIFEST/i);
});

// ---------------------------------------------------------------------------
// brainstorm skill
// ---------------------------------------------------------------------------
test("brainstorming skill exists", async () => {
  const skill = await read("skills/brainstorming/SKILL.md");

  assert.match(skill, /creative/i);
  assert.match(skill, /explor/i);
});

// ---------------------------------------------------------------------------
// dispatching-parallel-agents skill
// ---------------------------------------------------------------------------
test("dispatching-parallel-agents skill exists", async () => {
  const skill = await read("skills/dispatching-parallel-agents/SKILL.md");

  assert.match(skill, /parallel/i);
  assert.match(skill, /subagent/i);
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

test("all agent files exist and have valid frontmatter", async () => {
  const agents = [
    "architecture-auditor",
    "code-implementer",
    "code-reviewer",
    "codebase-qa-agent",
    "db-architect",
    "debugging-engineer",
    "devops-engineer",
    "diagram-engineer",
    "docs-engineer",
    "docs-generator",
    "memory-librarian",
    "multi-repo-orchestrator",
    "refactoring-engineer",
    "rollback-engineer",
    "secret-scanner",
    "test-engineer",
    "todo-checker",
    "ui-engineer",
    "vulnerability-scanner",
    "workflow-planner",
  ];
  for (const name of agents) {
    const content = await read(`agents/${name}.md`);
    assert.match(content, /^---\n/, `${name} should have frontmatter`);
  }
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
test("coder-workflow command defines orchestrator trigger", async () => {
  const cmd = await read("commands/coder-workflow.md");

  assert.match(cmd, /coder-orchestrator/i);
  assert.match(cmd, /workflow-planner/i);
  assert.match(cmd, /architecture-auditor/i);
  assert.match(cmd, /Bug Fix Phase/i);
});

test("all command files exist", async () => {
  const cmds = [
    "adr",
    "api-contract",
    "audit",
    "coder-workflow",
    "complexity",
    "config-validator",
    "coverage",
    "db-schema",
    "db",
    "deadcode",
    "debug",
    "deploy",
    "diagram",
    "docs",
    "doctor",
    "git-hooks",
    "i18n",
    "licenses",
    "logs",
    "memory",
    "multirepo",
    "ops",
    "performance",
    "plan",
    "pr",
    "qa",
    "refraktor",
    "review",
    "secrets",
    "semantic-search",
    "stats",
    "test",
    "think",
    "timetravel",
    "todos",
    "ui",
    "vuln",
  ];
  for (const cmd of cmds) {
    const content = await read(`commands/${cmd}.md`);
    assert.match(content, /^---\n/, `${cmd} should have frontmatter`);
  }
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

test("hooks.json defines safety and guard hooks", async () => {
  const hooks = JSON.parse(await read("hooks/hooks.json"));

  assert.ok(hooks.hooks.PreToolUse, "PreToolUse hook missing");
  assert.ok(hooks.hooks.PostToolUseFailure, "PostToolUseFailure hook missing");
  assert.ok(hooks.hooks.StopFailure, "StopFailure hook missing");
  assert.ok(hooks.hooks.FileChanged, "FileChanged hook missing");
});
