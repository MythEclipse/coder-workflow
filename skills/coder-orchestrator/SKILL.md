---
name: coder-orchestrator
description: Use when starting any coding conversation — establishes how to find and use coding skills, requiring Skill tool invocation before ANY response including clarifying questions. Always invoke for: implement, fix, refactor, audit, test, deploy, debug, review, or any request that touches source code. Also handles codebase exploration — graph before grep, graph before find, graph before Explore agents.
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

## Graph-First Before Search

**Graph before grep. Graph before find. Graph before Explore agents.** Use CodeGraph Mapper for structure, dependencies, callers, routes, components, architecture, impact, risk, flow, project-structure mapping. Use CodeGraph text search (`search_code` MCP or CLI `search`) for exact literal text search or regex. Raw grep/find/Explore are fallbacks only after graph/search tools cannot answer.

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

### Workflow Skills

| Request | Route to skill |
|---------|---------------|
| Implement feature, fix bug, write tests, work on code | `coder` |
| Audit architecture, layer violations, fat controllers | `auditor` |
| Refactor to Modular MVC + Service + Repository | `refraktor` |
| Setup Docker, CI/CD, VPS deploy, Traefik | `deploy-docker` |
| Batch file reads / parallel searches | `batch-codegraph` |

### CodeGraph (Codebase Exploration) Skills

| User asks | Use skill |
|-----------|-----------|
| Build/refresh graph or explore repo | `scan-codegraph` |
| Read 5+ files or search 5+ patterns | `batch-codegraph` |
| Where is X / who calls Y / what imports Z | `query-codegraph` |
| Exact text/regex search (TODO, error string, etc.) | `query-codegraph` + `search_code` |
| Architecture / impact / cycles / orphans / hotspots | `analyze-codegraph` |
| Refactor to Modular MVC + Service + Repository | `modular-mvc-refactor` (→ delegates to `refraktor`) |
| Export Mermaid / DOT / JSON / Markdown / HTML | `export-codegraph` |
| Interactive graph visualization | `open-codegraph-ui` |

**If multiple skills apply — invoke ALL of them in dependency order.**

## CodeGraph-First Workflow

1. Classify request (coding? structure? lookup? search? impact? refactor? export? visualize?).
2. If graph missing/stale, use `scan-codegraph` first.
3. Route to appropriate skill per matrix above.
4. Read source files only after graph identifies precise targets.

### Fallback Order

1. **Graph tools** — `query_graph`, `search_code`, `analyze_impact`, etc.
2. **CLI tools** — `codegraph-mapper query`, `codegraph-mapper search`, etc.
3. **Fallback** — grep/find/Explore agents (only after graph/search cannot answer)

### Graph Before Grep

| Instead of | Use |
|-----------|-----|
| `grep -r "UserRepository" .` | `query_graph("UserRepository")` |
| `find . -name "*.route.ts"` | `query_graph("routes")` |
| `grep -r "import.*auth" .` | `query_graph("what imports auth")` |
| Explore agent for architecture | `analyze-codegraph` |

### Benchmark Flow (First Exploration)

When first exploring a codebase:
1. `scan-codegraph` — build graph
2. `summarize_architecture` — get overview
3. `summarize_graph` — understand scale
4. `analyze_quality` — check for issues
5. Route subsequent work based on findings

### Red Flags

- Graph missing: run `scan-codegraph` before proceeding
- Graph stale: user reports recent changes not reflected; suggest rescan
- User asks for grep/find/Explore before graph: redirect to graph-backed skill first
- Ambiguous request: ask for clarification before routing

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
- **NEVER** use the built-in Explore agent — use codegraph MCP tools instead
- **Parallel execution**: tasks with disjoint file sets MAY run in parallel with worktree isolation. See code-implementer agent for parallel decision algorithm.

### Explore Agent — BANNED

The built-in `Explore` agent is FORBIDDEN for all coding sessions. Every exploration must go through codegraph MCP tools:

| Instead of Explore agent | Use codegraph MCP |
|---|---|
| "find database schema" | `mcp__codegraph__query_graph` + `mcp__codegraph__read_file` |
| "search for routes" | `mcp__codegraph__query_graph` (query: "routes" or "handler") |
| "trace call chain" | `mcp__codegraph__analyze_impact` |
| "find all imports of X" | `mcp__codegraph__query_graph` (def/references) |
| "map architecture" | `mcp__codegraph__summarize_architecture` |
| "find cycles" | `mcp__codegraph__find_cycles` |
| "search for TODO/FIXME text" | `mcp__codegraph__search_code` |

**Why:** Explore agent burns tokens reading files without graph context. CodeGraph MCP gives precise answers before any file read. **Always query graph first.**

## Core Mandates

1. **Tasks before tools.** Before running ANY other tools (such as Grep, ViewFile, run_command, or CodeGraph MCP tools) at the start of a session or when receiving a new task, you MUST first run `TaskCreate` to initialize workflow tracking. Create an initial task (e.g., 'Explore codebase and plan implementation') and set it to `in_progress` immediately using `TaskUpdate`. This prevents warnings about task tools not being used.
2. **Skills before guesses.** Always route to the appropriate skill — never implement ad-hoc.
3. **MCP before Explore.** Use codegraph MCP tools for all codebase exploration. NEVER use the built-in Explore agent.
4. **Context7 before assumptions.** Never guess framework/API behavior — query docs first.
5. **Graph before grep.** Scan codebase graph before broad file search.
6. **Never give up.** If stuck, decompose further, research more, ask clarifying questions.
7. **Fix every discovered bug.** Never skip as "not related to my changes." Create task, fix in Bug Fix Phase.

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
Route: query-codegraph
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
