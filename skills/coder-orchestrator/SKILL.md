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

This is not negotiable. This is not optional. You cannot rationalize your way out of using skills.
</EXTREMELY-IMPORTANT>

## Instruction Priority

Coder-workflow skills override default system prompt behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, direct requests) — highest priority
2. **Coder-workflow skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

# How to Use This Orchestrator

## The Rule

**Invoke relevant skills BEFORE any response or action.** Even a 1% chance a skill might apply means that you MUST invoke the skill to check. If an invoked skill turns out to be wrong for the situation, you don't need to use it — but you MUST check first.

```
User message → Invoke coder-orchestrator (THIS skill — ALWAYS)
             → Invoke codegraph-orchestrator (ALWAYS — for efficient codebase exploration)
             → Check: might any other skill apply? → YES → Invoke Skill tool
                                                       → Announce: "Using [skill] to [purpose]"
                                                       → Follow skill exactly
                                                       → Skill delegates to sub-agents
                                                       → Execute
                                                       → NO → Respond (including clarifications)
```

## Dual-Orchestrator Model

**Two orchestrators work together — they are complementary, not conflicting:**

| Orchestrator | Purpose | When |
|---|---|---|
| **`coder-orchestrator`** | WORKFLOW GUIDE — how to plan, implement, verify, fix bugs, run agents | ALWAYS triggers for any coding request |
| **`codegraph-orchestrator`** | SEARCH GUIDE — how to explore codebase efficiently using MCP tools | ALWAYS loaded by coder-orchestrator for code search/exploration |

**The flow:**

```
coder-orchestrator (ENTRY POINT — main brain for coding workflow)
├── ALWAYS invoke codegraph-orchestrator (search/exploration guide)
│   ├── scan-codegraph (build/refresh graph)
│   ├── query-codegraph (find definitions, references, callers)
│   ├── analyze-codegraph (impact, architecture, cycles, orphans)
│   └── search_code (exact literal/regex search)
├── Route to workflow skills
│   ├── coder (implementation)
│   ├── auditor (architecture review)
│   ├── refraktor (structural refactor)
│   └── deploy-docker (deployment)
└── Invoke sub-agents
    ├── workflow-planner (decompose)
    ├── architecture-auditor (pre/post audit)
    └── code-implementer (execute)
```

**ALWAYS invoke `codegraph-orchestrator` immediately after this skill.** It provides the efficient search/exploration patterns (graph before grep, query before read, analyze before edit) that the coding workflow depends on.

## What Triggers This Orchestrator

**ALWAYS invoke this skill** when the user asks about ANY of the following:

| Request Type | Trigger |
|---|---|
| Implement / build / create / add | Any feature, function, endpoint, UI element |
| Fix / debug / resolve | Any bug, error, crash, warning, deprecation |
| Refactor / reorganize / restructure | Any code movement, layer extraction, module split |
| Audit / review / check | Any architecture, layer, coupling, quality question |
| Test / verify / validate | Any test writing, test running, coverage question |
| Deploy / setup / configure | Any CI/CD, Docker, VPS, Traefik, environment |
| "Work on this" / "kerjakan" / "buat" | Any vague coding request |

**If ANY of the above match — invoke this skill BEFORE anything else.**

## Skill Routing Matrix

After this orchestrator AND codegraph-orchestrator are invoked, check which sub-skill applies:

| Request | Route to skill |
|---------|---------------|
| Implement feature, fix bug, write tests, work on code | `coder` |
| Audit architecture, layer violations, fat controllers | `auditor` |
| Refactor to Modular MVC + Service + Repository | `refraktor` |
| Setup Docker, CI/CD, VPS deploy, Traefik | `deploy-docker` |
| Batch file reads / parallel searches | `batch-codegraph` |

**If multiple skills apply — invoke ALL of them in dependency order.**

## Agent Coordination

After skills are invoked, use sub-agents for larger work:

| Agent | When to invoke |
|-------|---------------|
| `workflow-planner` | ANY unclear scope, multi-file work, or decomposition needed |
| `architecture-auditor` | ANY architecture review, layer violation check, refactor risk |
| `code-implementer` | After a plan exists, for scoped implementation |

**Minimum agent sequence for every coding session:**

```
workflow-planner (decompose) → architecture-auditor (pre-audit) → code-implementer (implement) → architecture-auditor (post-verify)
```

## Red Flags

These thoughts mean STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple fix" | Simple fixes need skills too. Check first. |
| "I need more context first" | Skill check comes BEFORE exploring. |
| "Let me read the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git status quickly" | Files lack workflow context. Check for skills. |
| "This doesn't need formal workflow" | If a skill exists, use it. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what to do" | Knowing ≠ following workflow. Invoke the skill. |
| "Not related to my changes" | If you see a bug, you own it. Track and fix it. |
| "Pre-existing, skipping" | Create task, fix in Bug Fix Phase. |

## Core Mandates

1. **Tasks before tools.** Every coding request MUST be decomposed into tracked tasks via `TaskCreate`.
2. **Skills before guesses.** Always route to the appropriate skill — never implement ad-hoc.
3. **MCP before grep.** Use codegraph MCP tools for code search (via codegraph-orchestrator). Use context7 MCP for docs.
4. **Context7 before assumptions.** Never guess framework/API behavior — query docs first.
5. **Never give up.** If stuck, decompose further, research more, ask clarifying questions.
6. **Fix every discovered bug.** Never skip as "not related to my changes." Create task, fix in Bug Fix Phase.

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
Also invoked: codegraph-orchestrator (for efficient codebase search/exploration)
Skills invoked: [list]
Agents invoked: [list]
Tasks created: [count]
```
