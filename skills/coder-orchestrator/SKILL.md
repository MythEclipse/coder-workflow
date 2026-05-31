---
name: coder-orchestrator
description: Use when starting any coding conversation — establishes how to find and use coding skills, requiring Skill tool invocation before ANY response. Always invoke for: implement, fix, refactor, audit, test, deploy, debug, review, or any request that touches source code.
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.
IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
</EXTREMELY-IMPORTANT>

## Instruction Priority

1. **User's explicit instructions** (CLAUDE.md, direct requests) — highest priority
2. **Coder-workflow skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

# How to Use This Orchestrator

## The Rule

**Invoke relevant skills BEFORE any response or action.** Even a 1% chance a skill might apply means that you MUST invoke the skill to check.

```
User message → Invoke coder-orchestrator (THIS skill — ALWAYS)
             → Check: might any other skill apply? → YES → Invoke Skill tool
                                                       → Follow skill exactly
```

## What Triggers This Orchestrator

| Request Type | Trigger |
|---|---|
| Implement / build / create | Any feature, function, endpoint, UI element |
| Fix / debug / resolve | Any bug, error, crash, warning |
| Refactor / reorganize | Any code movement, layer extraction |
| Audit / review | Any architecture, layer, quality question |
| Test / verify | Any test writing, test running |
| Deploy / setup | Any CI/CD, Docker, VPS |
| "Work on this" / "kerjakan" | Any vague coding request |
| Explore | Codebase exploration, start of session |

## Agent Coordination (Single-Agent Continual Flow)

Avoid extreme context fragmentation. The orchestrator routes work and retains context for the primary execution. Use sub-agents **only** for strictly isolated verification or auditing tasks, never for the core sequential implementation.

### Workflow Sequence

1. **Plan & Decompose**: Extract tasks via `workflow-planner` (Feature-Slice Decomposition).
2. **Sequential Implementation**: You (the orchestrator/main agent) execute the implementation directly using the `code-implementer` protocol to maintain continuity of context.
3. **Targeted Verification**: Run typechecks and linters **scoped ONLY to the modified files**.
4. **Impact Radius Quarantine**: Fix bugs strictly within the files you changed.
5. **Auditing (Optional)**: Dispatch `architecture-auditor` or `test-engineer` sub-agents if structural review or test generation is explicitly requested.

### Status Handling

- Track your progress using a checklist (e.g., `task.md`).
- If blocked, do not delegate away the problem. Research via `context7` MCP or `mcp__codegraph` tools, then adjust the plan.

## Impact Radius Bug Discovery Mandate

**You operate under an Impact Radius Protocol.**

1. **Declare Scope**: Define the files you intend to modify upfront (`FILE_MANIFEST`).
2. **Quarantine Zone**: If you encounter errors, type issues, or lint warnings during your work, you MUST fix them **IF AND ONLY IF** they are located within your declared `FILE_MANIFEST` or were directly introduced by your changes.
3. **External Dependencies Escaping**: If fixing a bug within your `FILE_MANIFEST` absolutely requires modifying a closely coupled external file (e.g., updating an interface), you are permitted to add that file to your `FILE_MANIFEST` and fix it. However, if the fix requires widespread architectural changes outside your scope, REVERT your breaking change and document it as a blocker instead of entering an infinite loop.
4. **Pre-existing Debt**: If a global typecheck reveals errors in untouched modules, **IGNORE THEM**. Document them as pre-existing technical debt. Do not attempt a global fix unless explicitly instructed by the user. Trying to fix the entire world leads to infinite loops.
5. **Targeted Checks**: Always run verification commands tailored to your specific files (e.g., `npx eslint path/to/changed/file.ts` rather than `npm run lint`).

## Output Contract

When this orchestrator is invoked, state:

```
Using coder-orchestrator to route: [one-sentence goal]
Skills invoked: [list]
Architecture pattern: [MVC | Event-Driven | Library | etc.]
Execution Flow: Single-Agent Continual Flow
```

Keep answers graph-backed for exploration queries. Example:
```
Request: "Who calls auth middleware?"
Answer:
- src/routes/auth.ts:authMiddleware called by:
  1. src/server.ts:setupRoutes (line 42)
```

## Session Metrics (Optional)

At session end, save metrics to `.claude/session-metrics.json`.
