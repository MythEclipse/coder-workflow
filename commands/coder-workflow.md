---
name: coder-workflow
aliases: [coder:workflow, orchestrator]
description: Orchestrate coding work through aggressive task decomposition, skill-first routing, and persistent execution. Always trigger orchestrator for any coding task.
argument-hint: [task-optional]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Trigger the coder-orchestrator skill. Every coding request flows through:

0. **Brainstorming** → Invoke `brainstorming` skill if the request is underspecified before planning.
1. **Trivial Task Fast-Path** → If the request is a trivial fix (e.g., typo, 1-2 line change), SKIP planning and execute directly.
2. **Decompose** → For complex tasks, `workflow-planner` agent breaks work into N independent tasks.
3. **Pre-audit** → `architecture-auditor` agent reviews current state (skip for simple tasks).
4. **Swarm Dispatch (CRITICAL)** → Spawn **1 subagent per task** using `Agent` tool with `run_in_background: true`. If planner produced 10 tasks, spawn 10 subagents simultaneously. Each subagent receives exactly 1 task. Do NOT batch tasks into a single agent.
5. **Synthesis** → After ALL subagents complete, collect results, detect conflicts, merge.
6. **Post-verify** → `architecture-auditor` confirms no new violations (complex tasks only).
7. **Bug Fix Phase** → Fix discovered bugs; each bug = 1 subagent task.

**Core rules:**
- **1 task = 1 subagent** — never give multiple tasks to one agent
- Tasks before tools — Run `TaskCreate` before tools
- Skills before guesses — always route to appropriate skill
- Fix every discovered bug — no "not related to my changes"
- Set `CW_AGENT_DEPTH=1` before spawning subagents to prevent recursive delegation

If a specific task is provided, decompose it. If no task, ask what to work on and start the orchestrator flow.


> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via explorer subagents instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
