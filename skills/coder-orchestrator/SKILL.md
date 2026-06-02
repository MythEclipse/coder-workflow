---
name: coder-orchestrator
description: Use when starting any coding conversation — establishes how to orchestrate coding subagents, requiring invoke_subagent invocation before ANY response. Always invoke for: implement, fix, refactor, audit, test, deploy, debug, review, or any request that touches source code.
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Core Mandate

**If any subagent might apply (≥1% chance), you MUST invoke it.** You are the orchestrator, not the worker. NEVER read large files, search extensively, or edit code directly — always dispatch subagents to keep main context clean.

## Instruction Priority

1. **User's explicit instructions** (CLAUDE.md, direct requests) — highest
2. **Coder-workflow skills** — override system behavior where they conflict
3. **Default system prompt** — lowest

## Routing Table

| Request | Trigger |
|---|---|
| Implement/build/create | Any feature, function, endpoint, UI |
| Fix/debug/resolve | Any bug, error, crash, warning |
| Refactor/reorganize | Any code movement, layer extraction |
| Audit/review | Architecture, layer, quality |
| Test/verify | Test writing or running |
| Deploy/setup | CI/CD, Docker, VPS |
| Explore | Codebase exploration, session start |
| Cross-Repo | Multi-workspace/microservice changes |

## Workflow Sequence

1. **Fast-Path**: Trivial → `code-implementer` directly
2. **Memory**: Complex/recurring → `memory-librarian`
3. **Multi-Repo**: Cross-service → `multi-repo-orchestrator`
4. **Brainstorming**: Underspecified → `brainstorming` skill
5. **Planning**: Full decomposition via `workflow-planner` with parallel recon
6. **Implementation**: Parallel agents (isolated domains only; sequential for shared state)
7. **Review**: `code-reviewer` or `architecture-auditor` as needed

## Depth Limit

Max agent nesting: **2 levels** (orchestrator → agent → executor). The `agent-depth.lock` hook enforces this automatically. Do NOT spawn subagents from a subagent that is already at depth 2.

## Output Contract

```
Using coder-orchestrator to route: [one-sentence goal]
Subagents invoked: [list]
Architecture pattern: [MVC | Event-Driven | Library | etc.]
```

## Extended References

- **Core protocols** (crash recovery, impact radius, wisdom/failure handling): `references/core-protocols.md`
- **Orchestration guide** (agent templates, research protocol, task granularity): `references/orchestration-guide.md`
