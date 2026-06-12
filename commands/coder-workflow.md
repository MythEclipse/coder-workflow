---
name: coder-workflow
aliases: [coder:workflow, orchestrator]
description: Orchestrate coding work through aggressive task decomposition, skill-first routing, and persistent execution. Always trigger orchestrator for any coding task.
argument-hint: [task-optional]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

You MUST execute this task by writing and running a native Dynamic Workflow script. (Treat this as a direct request for a workflow, functionally equivalent to using the `ultracode` keyword).

Never dispatch raw agents manually or write custom parallel loops in the conversation. Build the orchestration as a proper workflow script.

1. Determine Tier first (see coder-orchestrator SKILL.md Complexity Gate).

---

## Tier 2 — Full Orchestration (default for broad/cross-cutting tasks)

Write a native Dynamic Workflow script that implements the following phases. Ensure that intermediate results are kept in script variables.

Phases:
1. Brainstorm: clarify intent if underspecified (ask the user first before finalizing the script if needed).
2. Discover: Spawn discovery subagents to map codebase (trace data flows, module boundaries, gaps) and query cross-agent memory for prior context.
3. Plan: Decompose task into atomic units with FILE_MANIFEST per task (target ≤3 files).
4. Swarm: Spawn 1 subagent per task from the plan output concurrently to leverage native swarming capabilities.
5. Verify: Spawn an architecture-auditor subagent to run a post-execution audit (confirm no layer violations, no circular deps, no dead imports).
6. Synthesize: Collect outputs, resolve conflicts, produce a final report.

---

## Tier 1 — Scoped Fast-Path (≤3 explicit files/functions)

Write a simple Dynamic Workflow script that spawns a targeted subagent for the specific named scope to execute the task.

---

## Core Rules

- **Native Dynamic Workflows** — You must write and run a native workflow script. Do not write custom orchestration logic in your conversational response.
- **1 task = 1 subagent** — never batch tasks into one subagent
- **No worktrees** — all agents run in the same shared workspace
- **Tasks before tools** — Run `TaskCreate` before any tool call
- **Fix every discovered bug** — no "not related to my changes"
- **Swarm Chat** — Parallel agents coordinate via `mcp__codegraph__send_swarm_message` + `mcp__codegraph__read_swarm_messages`

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via `coder-workflow:explore-codebase` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
