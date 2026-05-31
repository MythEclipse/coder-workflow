---
description: Orchestrate coding work through aggressive task decomposition, skill-first routing, and persistent execution. Always trigger orchestrator for any coding task.
argument-hint: [task-optional]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Trigger the coder-orchestrator skill. Every coding request flows through:

0. **Brainstorming** → Invoke `brainstorming` skill if the request is underspecified before planning.
1. **Decompose** → `workflow-planner` agent breaks work into independent tasks for parallel execution.
2. **Pre-audit** → `architecture-auditor` agent reviews current state and violations (skip for simple tasks)
3. **Parallel Implement** → Spawn multiple subagents simultaneously using the Task tool (e.g., `explorer`, `implementer`, `test-writer`, `docs-updater`).
4. **Synthesis** → Merge results from parallel subagents, resolve conflicts, and present a unified result.
5. **Post-verify** → `architecture-auditor` agent confirms no new violations (complex tasks only)
6. **Bug Fix Phase** → ALL discovered bugs are fixed before session ends

**Core rules:**
- Tasks before tools — Run `TaskCreate` + `TaskUpdate` to create an initial task (e.g. 'Explore codebase') before running any other tools.
- Skills before guesses — always route to appropriate skill
- Fix every discovered bug — no "not related to my changes"
- Set `CW_AGENT_DEPTH=1` in the environment before spawning any subagent to prevent recursive delegation

If a specific task is provided, decompose it. If no task, ask what to work on and start the orchestrator flow.
