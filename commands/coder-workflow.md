---
description: Orchestrate coding work through aggressive task decomposition, skill-first routing, and persistent execution. Always trigger orchestrator for any coding task.
argument-hint: [task-optional]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Trigger the coder-orchestrator skill. Every coding request flows through:

0. **Brainstorming** → Invoke `brainstorming` skill if the request is underspecified before planning.
1. **Trivial Task Fast-Path** → If the request is a trivial fix (e.g., typo, 1-2 line change), SKIP planning and auditing, and execute directly.
2. **Decompose** → For complex tasks, `workflow-planner` agent breaks work into independent tasks.
3. **Pre-audit** → `architecture-auditor` agent reviews current state and violations (skip for simple tasks).
4. **Parallel Implement** → Spawn multiple subagents carefully using the Task tool, ensuring modifying agents don't overlap.
5. **Synthesis** → Merge results from subagents, resolve conflicts, and present a unified result.
6. **Post-verify** → `architecture-auditor` agent confirms no new violations (complex tasks only).
7. **Bug Fix Phase** → Fix discovered bugs using the Impact Radius Protocol (with Technical Debt deferrals if needed).

**Core rules:**
- Tasks before tools — Run `TaskCreate` + `TaskUpdate` to create an initial task (e.g. 'Explore codebase') before running any other tools.
- Skills before guesses — always route to appropriate skill
- Fix every discovered bug — no "not related to my changes"
- Set `CW_AGENT_DEPTH=1` in the environment before spawning any subagent to prevent recursive delegation

If a specific task is provided, decompose it. If no task, ask what to work on and start the orchestrator flow.


> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via explorer subagents instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
