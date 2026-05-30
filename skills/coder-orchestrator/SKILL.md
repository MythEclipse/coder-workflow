---
name: coder-orchestrator
description: Use when starting any coding conversation — establishes how to find and use coding skills, requiring Skill tool invocation before ANY response including clarifying questions. Always invoke for: implement, fix, refactor, audit, test, deploy, debug, review, or any request that touches source code.
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.
IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
This is not negotiable. This is not optional.
</EXTREMELY-IMPORTANT>

## Instruction Priority

1. **User's explicit instructions** (CLAUDE.md, direct requests) — highest priority
2. **Coder-workflow skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

# How to Use This Orchestrator

## The Rule

**Invoke relevant skills BEFORE any response or action.** Even a 1% chance a skill might apply means that you MUST invoke the skill to check. If an invoked skill turns out to be wrong for the situation, you don't need to use it — but you MUST check first.

```
User message → Invoke coder-orchestrator (THIS skill — ALWAYS)
             → Check: might any other skill apply? → YES → Invoke Skill tool
                                                       → Announce: "Using [skill] to [purpose]"
                                                       → Follow skill exactly
                                                       → NO → Respond (including clarifications)
```

## What Triggers This Orchestrator

| Request Type | Trigger |
|---|---|
| Implement / build / create / add | Any feature, function, endpoint, UI element |
| Fix / debug / resolve | Any bug, error, crash, warning, deprecation |
| Refactor / reorganize / restructure | Any code movement, layer extraction, module split |
| Audit / review / check | Any architecture, layer, coupling, quality question |
| Test / verify / validate | Any testwriting, test running, coverage question |
| Deploy / setup / configure | Any CI/CD, Docker, VPS, Traefik, environment |
| "Work on this" / "kerjakan" / "buat" | Any vague coding request |
| Understand repo / search code / architecture / impact / flow | Codebase exploration, start of session, first repo exploration |

**Trigger even without explicit codegraph mention.** This orchestrator routes BOTH coding work AND codebase search.

## Skill Routing Matrix

After the orchestrator is invoked, check which sub-skill applies:

| Request | Route to skill |
|---------|---------------|
| Implement feature, fix bug, write tests, work on code | `coder` |
| Audit architecture, layer violations, fat controllers | `auditor` |
| Refactor to Modular MVC + Service + Repository | `refraktor` |
| Setup Docker, CI/CD, VPS deploy, Traefik | `deploy-docker` |

**If multiple skills apply — invoke ALL of them in dependency order.**

Codebase exploration (graph, search, architecture analysis) is handled automatically by hooks — no skill invocation needed. Use codegraph MCP tools directly via hooks guidance.

## Agent Coordination (Right-Sized Subagent Pattern)

After skills are invoked, use sub-agents following the **Right-Sized Subagent** pattern:

**Core principle: Scale agent chain to task complexity.** Simple tasks execute directly. Complex tasks get full SDD chain.

### Complexity Triage

| Complexity | Criteria | Workflow |
|---|---|---|
| **Simple** | 1-2 files, clear spec, typo fix, config change | Direct implement -> self-verify -> complete |
| **Standard** | 3-5 files, moderate coordination | Implement -> lightweight spec review -> complete |
| **Complex** | 5+ files, architectural change, new patterns | Full SDD: implementer -> spec review -> quality review -> loop |

### The Dispatch Sequence (Complex Tasks Only)

```
controller (YOU)
├── Extract ALL tasks from workflow-planner output
├── FOR EACH task (in dependency order):
│   ├── Simple? → implement directly → self-verify → next
│   ├── Standard? → implement → light spec review → next
│   └── Complex? → Full SDD chain:
│   │   ├── Dispatch FRESH implementer sub-agent
│   │   ├── Handle status: DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT
│   │   ├── Dispatch FRESH spec review sub-agent
│   │   ├── Handle: ✅ approved → proceed | ❌ issues → fix → re-review
│   │   └── Dispatch FRESH code quality sub-agent
│   └── Track ALL discovered bugs as TaskCreate
├── Bug Fix Phase: fix all High/Medium bugs
└── Final code review + mark session complete
```

### Status Handling

| Agent reports | Controller action |
|---------------|------------------|
| DONE | Proceed to spec compliance review |
| DONE_WITH_CONCERNS | Read concerns → address if correctness/scope → proceed to review |
| NEEDS_CONTEXT | Provide missing context → re-dispatch same task same agent |
| BLOCKED | Assess: context problem → re-dispatch; too large → split; plan wrong → re-plan |

### Model Selection

| Task Complexity | Model | Description |
|----------------|-------|-------------|
| Mechanical (1-2 files, clear spec) | haiku | Fast, low token cost for simple file modifications, typos, tests, and formatting |
| Integration (multi-file, coordination) | inherit (default) | High capability (inherits active Sonnet session) for complex editing |
| Review (architecture, quality, spec) | haiku | Efficient auditing and conformity checking against defined criteria |

### Rules

- **NEVER** reuse sub-agents for Complex tasks — FRESH agent per task
- **NEVER** skip reviews for Complex tasks — spec compliance THEN code quality, in that order
- **NEVER** dispatch multiple implementers in parallel for overlapping files — check file overlap first
- **NEVER** make sub-agent read plan file — provide FULL task text directly
- **Parallel execution**: tasks with disjoint file sets MAY run in parallel with worktree isolation. See code-implementer agent for parallel decision algorithm.

## Core Mandates

## Bug Discovery Mandate

**Every bug discovered during implementation MUST be tracked and fixed.** This includes:

- Browser API deprecation warnings
- Console errors or warnings unrelated to current changes
- Type errors in files you didn't edit
- Lint violations in untouched files
- Broken tests that pre-date your changes

**Required behavior:**
1. Create `TaskCreate` with severity and description for every bug found
2. Continue primary work — do NOT context-switch mid-implementation
3. After ALL primary tasks complete: enter Bug Fix Phase
4. Fix each bug in order: Blocker → High → Medium
5. Session is NOT complete until all High and Medium bugs are fixed

## Output Contract

When this orchestrator is invoked, state:

```
Using coder-orchestrator to route: [one-sentence goal]
Skills invoked: [list]
Agents invoked: [list]
Tasks created: [count]
Architecture pattern: [MVC | GraphQL | CLI | Event-Driven | Functional | Library]
Complexity mix: Simple [N] | Standard [N] | Complex [N]
```

For codebase exploration queries, keep answers graph-backed: file paths, symbols, nodes, edges, uncertainty noted. Example:

```
Request: "Who calls the auth middleware?"
Answer:
- src/routes/auth.ts:authMiddleware called by:
  1. src/server.ts:setupRoutes (line 42)
  2. src/routes/admin.ts:adminRoutes (line 15)
```

## Session Metrics (Optional)

At session end, save metrics to `.claude/session-metrics.json`:

```json
{
  "sessionDate": "ISO-8601",
  "tasksCreated": N,
  "tasksCompleted": N,
  "bugsDiscovered": N,
  "bugsFixed": N,
  "agentInvocations": {"workflow-planner": N, "architecture-auditor": N, "code-implementer": N, "test-engineer": N},
  "complexityMix": {"simple": N, "standard": N, "complex": N},
  "reviewPassRate": "X%",
  "parallelBatches": N,
  "checkpointsUsed": N,
  "architecturePattern": "MVC"
}
```

These metrics enable trend tracking: is bug discovery rate decreasing? Is review pass rate improving? Are we right-sizing complexity appropriately?
