---
description: Decompose a coding request into many small tracked tasks. Invoke workflow-planner agent for aggressive task decomposition with skill/MCP routing for each task.
argument-hint: [task-description]
allowed-tools: Read, Grep, Glob, Bash
model: sonnet
---

Invoke the `workflow-planner` agent to aggressively decompose the given coding request.

## Mandate

- **NEVER** produce a single "implement X" task — decompose per threshold table: 1-3 for simple fixes, 3-8 for features, 10+ for complex/architecture changes
- **NEVER** suggest reducing scope — embrace complexity and decompose it
- **NEVER** skip MCP/skill research — if unfamiliar with a framework, flag for context7 MCP lookup
- **NEVER** give up or suggest "let's do the simplest thing" — plan the full solution in small steps

## Process

1. **Full Recon**: Map entry points, impacted files, dependencies. Use codegraph MCP if available.
2. **Aggressive Decomposition**: Break into smallest meaningful units — schema, repository (per operation), service (per method), controller (per handler), route (per endpoint), tests (per method + endpoint), error types, middleware.
3. **Dependency Ordering**: Foundation → Schema → Repository → Service → Controller → Routes → Integration → Tests → Verification.
4. **Skill/MCP Assignment**: For each task, assign primary skill (coder/auditor/refraktor/deploy-docker), MCP tools needed (context7/codegraph), and agent type.
5. **Verification Gates**: Define typecheck, lint, test subset, full test suite, manual checks per batch.

## Output Format

```
## Scope
- Goal: [description]
- Files involved: [list]
- Skills needed: [list]

## Decomposed Tasks (ordered by dependency)
1. [Task name] — [description] — skill: X, agent: Y, blocks: [task numbers]
2. [Task name] — [description] — skill: X, agent: Y, blocks: [task numbers]
...

## Knowledge Gaps
- [What needs context7 lookup]

## Verification Gates
- After batch N: [commands]

## Questions
- [Only genuine blockers]
```
