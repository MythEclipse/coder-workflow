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

## Agent Coordination (Superpowers Subagent Pattern)

After skills are invoked, use sub-agents following the **Subagent-Driven Development** pattern:

**Core principle: Fresh sub-agent per task + two-stage review = high quality, fast iteration.**

### The Dispatch Sequence

```
controller (YOU)
├── Extract ALL tasks from workflow-planner output
├── FOR EACH task (in dependency order):
│   ├── Dispatch FRESH implementer sub-agent (full task text + context)
│   ├── Handle status: DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT
│   ├── Dispatch FRESH spec review sub-agent (verify vs requirements)
│   ├── Handle: ✅ approved → proceed | ❌ issues → implementer fixes → re-review
│   ├── Dispatch FRESH code quality sub-agent (verify quality)
│   ├── Handle: ✅ approved → mark complete | ❌ issues → implementer fixes → re-review
│   └── Track ALL discovered bugs as TaskCreate
├── Bug Fix Phase: fix all High/Medium bugs
└── Final code review + mark session complete
```

### Model Selection

| Task Complexity | Model |
|----------------|-------|
| Mechanical (1-2 files, clear spec) | inherit (default) |
| Integration (multi-file, coordination) | inherit (default) |
| Review (architecture, quality, spec) | inherit (default) |

### Status Handling

| Agent reports | Controller action |
|---------------|------------------|
| DONE | Proceed to spec compliance review |
| DONE_WITH_CONCERNS | Read concerns → address if correctness/scope → proceed to review |
| NEEDS_CONTEXT | Provide missing context → re-dispatch same task same agent |
| BLOCKED | Assess: context problem → re-dispatch; too large → split; plan wrong → re-plan |

### Rules (From Superpowers)

- **NEVER** reuse sub-agents — FRESH agent per task, FRESH context
- **NEVER** skip reviews — spec compliance THEN code quality, in that order
- **NEVER** dispatch multiple implementers in parallel (conflicts)
- **NEVER** make sub-agent read plan file — provide FULL task text directly
- **NEVER** use the built-in Explore agent — use codegraph-orchestrator + MCP tools instead

### Explore Agent — BANNED

**The built-in `Explore` agent is FORBIDDEN for all coding sessions.** Every exploration must go through codegraph MCP tools via `codegraph-orchestrator`:

| Instead of Explore agent | Use codegraph MCP |
|---|---|
| Explore: "find database schema" | `mcp__codegraph__query_graph` + `mcp__codegraph__read_file` |
| Explore: "search for routes" | `mcp__codegraph__query_graph` (query: "routes" or "handler") |
| Explore: "trace call chain" | `mcp__codegraph__analyze_impact` |
| Explore: "find all imports of X" | `mcp__codegraph__query_graph` (def/references) |
| Explore: "map architecture" | `mcp__codegraph__summarize_architecture` |
| Explore: "find cycles" | `mcp__codegraph__find_cycles` |
| Explore: "search for TODO/FIXME text" | `mcp__codegraph__search_code` |

**Why:** Explore agent burns tokens reading files without graph context. CodeGraph MCP gives precise answers — file paths, symbols, edges — before any file read. Graph before grep. Graph before find. Graph before Explore. **Always query graph first.**
- **NEVER** pause between tasks to ask "should I continue?" — execute continuously
- **NEVER** accept "close enough" on spec compliance
- **NEVER** skip review loops — reviewer found issues = fix = review again
- **CONTROLLER** provides curated context, full task text, file targets, verification commands
- **SUB-AGENTS** ask questions BEFORE starting, not during

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
| "Let me use Explore to find..." | FORBIDDEN. Use codegraph MCP: query_graph, search_code, analyze_impact. |
| Using Explore agent for code search | Use `mcp__codegraph__query_graph` or `mcp__codegraph__search_code` instead. |
| Dispatching Explore subagent | Dispatch general-purpose agent with codegraph MCP tools instead. |

## Core Mandates

1. **Tasks before tools.** Every coding request MUST be decomposed into tracked tasks via `TaskCreate`.
2. **Skills before guesses.** Always route to the appropriate skill — never implement ad-hoc.
3. **MCP before Explore.** Use codegraph MCP tools for all codebase exploration. NEVER use the built-in Explore agent. Graph before grep. Graph before find. Graph before Explore.
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
