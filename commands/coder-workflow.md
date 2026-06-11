---
name: coder-workflow
aliases: [coder:workflow, orchestrator]
description: Orchestrate coding work through aggressive task decomposition, skill-first routing, and persistent execution. Always trigger orchestrator for any coding task.
argument-hint: [task-optional]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine. Never dispatch raw agents without a Workflow context.

Determine Tier first (see coder-orchestrator SKILL.md Complexity Gate), then run the matching template.

---

## Tier 2 — Full Orchestration (default for broad/cross-cutting tasks)

```
∴ coder-orchestrator [T2] → Workflow(<kebab-task-name>): <one-sentence goal>

∴ Workflow({
  name: '<kebab-task-name>',
  description: '<one-sentence goal>',
  phases: [
    { title: 'Brainstorm', detail: 'clarify intent if underspecified (skip if clear)' },
    { title: 'Discover',   detail: 'CodeGraph scan — map structure, find gaps' },
    { title: 'Plan',       detail: 'workflow-planner decomposes into atomic tasks' },
    { title: 'Swarm',      detail: '1 agent per task, all in parallel' },
    { title: 'Verify',     detail: 'architecture-auditor post-check' },
    { title: 'Synthesize', detail: 'collect outputs, resolve conflicts, produce report' },
  ],
})

phase('Brainstorm')  // only if request is underspecified — invoke Skill(brainstorming), NEVER as background agent
// → blocks until user approves design spec

phase('Discover')
const [exploration, context] = await parallel([
  () => agent(
    `Map codebase: trace data flows, identify module boundaries, find duplication, detect gaps relevant to: $ARGUMENTS`,
    { label: 'explore', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Query cross-agent memory for prior context on this task domain`,
    { label: 'memory-check', phase: 'Discover', agent: 'coder-workflow:memory-librarian' }
  ),
])

phase('Plan')
const plan = await pipeline([
  () => agent(
    `Decompose task into atomic units with FILE_MANIFEST per task. Each task targets ≤3 files.
Input: ${exploration}
User goal: $ARGUMENTS`,
    { label: 'decompose', phase: 'Plan', agent: 'coder-workflow:workflow-planner' }
  ),
])

phase('Swarm')
// Spawn 1 agent per task from plan output — ALL concurrent inside parallel()
const swarmResults = await parallel(
  plan.tasks.map(task => () => agent(
    task.prompt,
    { label: task.label, phase: 'Swarm', agent: task.agent }
  ))
)

phase('Verify')
const audit = await agent(
  `Post-execution audit: confirm no new layer violations, no circular deps, no dead imports.
  Swarm results summary: ${swarmResults.map(r => r.label).join(', ')}`,
  { label: 'post-audit', phase: 'Verify', agent: 'coder-workflow:architecture-auditor' }
)

phase('Synthesize')
const report = await agent(
  `Synthesize all results into a final report. Detect file conflicts, resolve merges.
  Inputs:\n${swarmResults.map(r => JSON.stringify(r)).join('\n---\n')}
  Audit: ${audit}`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { report, taskCount: plan.tasks.length, audit }
```

---

## Tier 1 — Scoped Fast-Path (≤3 explicit files/functions)

```
∴ coder-orchestrator [T1] → Workflow(<kebab-task-name>): <one-sentence goal>

∴ Workflow({
  name: '<kebab-task-name>',
  description: '<one-sentence goal>',
  phases: [
    { title: 'Execute', detail: 'targeted agent on named scope' },
  ],
})

phase('Execute')
const result = await agent(
  `$ARGUMENTS`,
  { label: 'execute', phase: 'Execute', agent: 'coder-workflow:<specialist-from-routing-table>' }
)

return result
```

---

## Core Rules

- **1 task = 1 agent() call** — never batch tasks into one agent
- **No worktrees** — all agents run in the same shared workspace
- **Tasks before tools** — Run `TaskCreate` before any tool call
- **Fix every discovered bug** — no "not related to my changes"
- **Swarm Chat** — Parallel agents coordinate via `mcp__codegraph__send_swarm_message` + `mcp__codegraph__read_swarm_messages`

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via `coder-workflow:explore-codebase` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
