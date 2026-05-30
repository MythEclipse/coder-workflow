---
description: Orchestrate coding work through aggressive task decomposition, skill-first routing, and persistent execution. Always trigger orchestrator for any coding task.
argument-hint: [task-optional]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Trigger the coder-orchestrator skill. Every coding request flows through:

1. **Decompose** → `workflow-planner` agent breaks work into tracked tasks (right-sized: 1-3 for simple, 3-8 for features, 10+ for complex)
2. **Pre-audit** → `architecture-auditor` agent reviews current state and violations (skip for simple tasks)
3. **Implement** → `code-implementer` agent (right-sized: simple=direct, complex=full SDD chain)
4. **Post-verify** → `architecture-auditor` agent confirms no new violations (complex tasks only)
5. **Bug Fix Phase** → ALL discovered bugs are fixed before session ends

**Core rules:**
- Tasks before tools — Run `TaskCreate` + `TaskUpdate` to create an initial task (e.g. 'Explore codebase') before running any other tools.
- Skills before guesses — always route to appropriate skill
- Fix every discovered bug — no "not related to my changes"

If a specific task is provided, decompose it. If no task, ask what to work on and start the orchestrator flow.
