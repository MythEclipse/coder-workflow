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

## Agent Coordination (Parallel Subagents — Always On)

Token cost is not a constraint. Speed and parallelism are the priority. Instruct Claude Code to ALWAYS decompose tasks into parallel subagents whenever possible. Do NOT work sequentially unless tasks have hard data dependencies on each other.

### When to Parallelize (default: always)
Split into parallel subagents for ANY of these patterns:
- **Multiple files to read/edit**: Refactor auth, api, db modules
- **Research + implementation**: Explore codebase while writing plan
- **Code + tests + docs**: Implement feature, write tests, update docs — all at once
- **Multi-directory exploration**: Explore frontend/, backend/, infra/ simultaneously
- **Review + fix**: Code review agent + fix agent run together
- **Multiple competitors / items**: Research 5 libs in parallel, one agent each

### Workflow Sequence

1. **Brainstorming**: If the request is a new feature or underspecified, invoke the `brainstorming` skill FIRST to solidify the design.
2. **Plan & Decompose**: Extract tasks via `workflow-planner` (Feature-Slice Decomposition) designed for parallel agents.
3. **Parallel Implementation**: Spawn multiple subagents simultaneously using the Task tool (e.g., `explorer`, `implementer`, `test-writer`, `docs-updater`).
4. **Synthesis & Verification**: Merge results, run targeted typechecks/linters scoped only to modified files, and fix bugs within the Impact Radius.
5. **Auditing (Optional)**: Dispatch `architecture-auditor` sub-agents if structural review is explicitly requested.

### Status Handling

- Track your progress using a checklist (e.g., `task.md`).
- If blocked, do not delegate away the problem. Research via `context7` MCP or `mcp__codegraph` tools, then adjust the plan.

### Crash Recovery (on Session Resume)

When resuming a session after a disconnect or token limit:

1. **Check `task.md`**: If it exists, read it and identify unchecked items (`[ ]`). Resume from the first incomplete task.
2. **Check TaskList**: Run `TaskList` to find tasks with `in_progress` status. If found, verify whether they were actually completed and update accordingly.
3. **Check `.claude/deferred-bugs.json`**: If present, review deferred bugs from the prior session. Fix them as part of your first Bug Fix Phase.
4. **Check `.claude/agent-depth.lock`**: If it exists with depth > 0, a subagent crashed. Delete the lock file before spawning new agents.
5. **Verify graph freshness**: Run `check_graph_freshness` MCP tool. If stale (>120 min), re-scan before deep analysis.
6. **Do NOT restart from scratch**: Pick up exactly where the checklist left off.

## Impact Radius Bug Discovery Mandate

**You operate under an Impact Radius Protocol with a unified triage system.**

1. **Declare Scope**: Define the files you intend to modify upfront (`FILE_MANIFEST`).
2. **Category A — Bugs Within Impact Radius**: If you encounter errors, type issues, or lint warnings **within your declared `FILE_MANIFEST`** or directly introduced by your changes, you **MUST fix them**. No deferral, no exceptions. You MUST invoke the `systematic-debugging` skill to perform root-cause analysis before attempting any fixes. Symptom fixing is strictly prohibited.
3. **Category B — Pre-existing Bugs Outside Impact Radius**: If a global typecheck reveals errors in untouched modules, apply a **budget-capped triage**:
   - Fix up to **5 High/Medium severity** Category B bugs per session.
   - Beyond 5, defer by writing to `.claude/deferred-bugs.json` with file:line, severity, and deferral reason.
   - Low severity Category B bugs are documented but do not block session completion.
   - **Never silently drop bugs.** Always record them as tracked tasks or deferred entries.
4. **External Dependencies Escaping**: If fixing a Category A bug requires modifying a closely coupled external file (e.g., updating an interface), you are permitted to add that file to your `FILE_MANIFEST` and fix it. If the fix requires widespread architectural changes outside your scope, REVERT your breaking change and document it as a blocker.
5. **Targeted Checks**: Always run verification commands tailored to your specific files (e.g., `npx eslint path/to/changed/file.ts` rather than `npm run lint`).
6. **Session Completion Rule**: Session is NOT complete until all Category A bugs AND up to 5 Category B bugs (High/Medium) are fixed. Any remaining deferred bugs appear in the final report.

## Output Contract

When this orchestrator is invoked, state:

Using coder-orchestrator to route: [one-sentence goal]
Skills invoked: [list]
Architecture pattern: [MVC | Event-Driven | Library | etc.]
Execution Flow: Parallel Subagents - Always On

Keep answers graph-backed for exploration queries. Example:
```
Request: "Who calls auth middleware?"
Answer:
- src/routes/auth.ts:authMiddleware called by:
  1. src/server.ts:setupRoutes (line 42)
```

## Session Metrics (Optional)

At session end, save metrics to `.claude/session-metrics.json`.
