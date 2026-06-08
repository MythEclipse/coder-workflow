# AI Workflow Analysis & Feature Recommendations

> **Goal:** Enable AI agents in the coder-workflow plugin to **LEARN** from experience, **WISE** in decision-making, and **DILIGENT** in maintaining quality.

---

## 📊 Existing State Summary

### What Already Exists (but not yet optimal):

| Area | Existing | Gap |
|------|----------|-----|
| **Memory** | Cross-Agent Memory, `.coder-memory/`, memory-librarian agent | Only stores, rarely auto-consulted |
| **Learning** | Headroom Learn (failure logging, correction matching) | Only failures, no success/user preference learning |
| **Session** | Session metrics, hooks lifecycle | No automatic cross-session knowledge carryover |
| **Quality** | Impact Radius, todo-checker, code-reviewer | No proactive guardian to prevent issues before they occur |
| **Decision** | ADR system | Too formal for daily micro-decisions |
| **Wisdom** | Orchestrator routing, workflow planner | No "risk assessment" before task execution |
| **Diligence** | PreToolUse/PostToolUse hooks, Stop hooks | Reactive — no automated pre-flight checks yet |

---

## 🧠 PILLAR 1: LEARN (Learning System)

### 1.1 Experience Journal — "Project Wisdom Archive"

**Problem:** Every session starts from zero. Valuable lessons from previous sessions are lost.

**Solution:** New **`experience-journal`** agent that automatically:
- **Post-Task Reflection:** After each task completes → record:
  - What worked? What didn't?
  - Root cause analysis of bugs found
  - Architectural decisions & rationale
  - Successful patterns / failed anti-patterns
- **Auto-Postmortem on Failure:** When a task fails 3× → auto-generate postmortem + store to memory
- **Wisdom Retrieval:** Before task starts → find relevant past lessons from the same project

**Implementation:**
```
agents/experience-journal.md
commands/experience.md → /experience
hooks/ → PostTaskReflection hook (auto-trigger)
```

### 1.2 Success Pattern Recognition — "What Works"

**Problem:** Headroom Learn only tracks *failures*. No system records *what works*.

**Solution:** Enhance `learn.ts` + hooks to:
- Track successful test passes (what pattern made tests pass?)
- Track user-accepted suggestions (user accepted refactor X → mark as preference)
- Track clean builds (what config worked?)
- Build "success signature database": `{ task_type, approach, outcome: "success" }`

**Key enhancement:**
```typescript
// In learn.ts, add:
export interface SuccessRecord {
  taskType: string;
  approach: string;
  pattern: string;
  outcome: "success" | "fast_pass";
  context: string;
  reusable: boolean;
}
```

### 1.3 Cross-Session Memory Consolidation

**Problem:** Memory in `.coder-memory/` and `.claude/cross-agent-memory/` is only filled manually.

**Solution:** When `SessionEnd` hook fires (already exists!), auto-extract:
- Architectural decisions → `decision-{date}.md`
- Debugging lessons → `lesson-{bug-pattern}.md`
- User preferences → `preference-{topic}.md`
- Important API changes → `reference-{module}-{date}.md`

**Hook enhancement:** Add `PostSessionEnd` consolidation logic in `session-metrics.sh` or a new agent.

### 1.4 User Preference Learning Profile

**Problem:** Users have style/naming/architecture preferences but must repeat them in every prompt.

**Solution:** Build auto-formed preference profile:
- From `CLAUDE.md` → parse explicit preferences
- From user edits → infer pattern (user always renames X to Y → learn)
- From code review feedback → record reviewer preferences

**Profile format:**
```json
{
  "naming": { "controllers": "Controller", "services": "Service" },
  "architecture": "modular-mvc",
  "validation": "zod",
  "testStyle": "unit-first",
  "preferredLibs": ["prisma", "fastify"],
  "dislikedPatterns": ["any types", "magic strings"]
}
```

---

## 🎯 PILLAR 2: WISE (Wisdom Layer)

### 2.1 Risk-Aware Task Execution

**Problem:** Agent executes immediately without knowing the risks — often hitting the same problems.

**Solution:** Before task execution, run a **Risk Assessment Query**:
1. **Are there past failures in this area?** → check `.claude/learn/failures.jsonl`
2. **Are there similar tasks before?** → check cross-agent memory
3. **What is the impact radius?** → already exists via Impact Radius Protocol
4. **What is the recommended approach?** → from experience journal

**Hook integration:** Add to `PreToolUse` for `Write/Edit` — check risk before editing.

### 2.2 Lite-ADR — "Micro Decision Log"

**Problem:** ADR is too formal for small daily decisions.

**Solution:** **Lite-ADR** / **Decision Snapshots** feature:
- Every time the agent chooses between multiple approaches → record as a decision snapshot
- Minimal format: `{ context, options, selected, rationale, timestamp }`
- Auto-called when `sequential_thinking` MCP is used
- Queryable: "Why did we choose X over Y?"

**CLI command:**
```bash
coder-workflow decision list
coder-workflow decision show <id>
coder-workflow decision why "chose prisma over typeorm"
```

### 2.3 Trade-off Analysis Engine

**Problem:** Agents often choose solutions without explicitly considering trade-offs.

**Solution:** **trade-off-analyzer** agent that:
- When receiving a task → generate 2-3 approaches with trade-off matrix
- Consider: complexity, maintainability, performance, security, learning curve
- Recommend based on project profile (preferences from Pillar 1.4)
- Store decision + trade-off to experience journal

**Trade-off Matrix output:**
```
## Approach Comparison: [Feature X]
| Criteria | Approach A (Prisma) | Approach B (Raw SQL) |
|----------|-------------------|---------------------|
| Complexity | Low | High |
| Performance | Medium | High |
| Type Safety | High | Low |
| Migration | Built-in | Manual |
| Team Familiarity | High | Low |

**Recommended:** Approach A (matches project pattern)
```

### 2.4 Knowledge Integration Hub

**Problem:** Agents need to know best practices from outside the codebase (docs, library updates).

**Solution:** **knowledge-integrator** agent that:
- Proactively uses Context7 MCP to check docs/library updates
- Integrates external knowledge with project patterns
- Provides "Did you know?" tips based on task context
- Maintains "library knowledge base" per project

---

## ⚡ PILLAR 3: DILIGENT (Diligence Automation)

### 3.1 Pre-Flight Checklist — "Auto Readiness Check"

**Problem:** Agents start working without checking project conditions.

**Solution:** Before task starts, auto-run checklist:

```
☐ Codebase typecheck: [PASS/FAIL]
☐ Lint status: [PASS/FAIL]
☐ Test status: [PASS/FAIL]
☐ Graph freshness: [OK/STALE]
☐ Past failures in area: [NONE/FOUND]
☐ Open deferred bugs: [NONE/N]
☐ Relevant memory entries: [NONE/FOUND]
```

**Implementation:** `PreToolUse` hook for `Agent` — run checklist before spawning subagent.

### 3.2 Proactive Quality Guardian Agent

**Problem:** Quality check happens *after* code is written, not *before*.

**Solution:** **`quality-guardian`** agent that:
- **Before write:** Check if file has pre-existing issues (type/lint/test)
- **During write:** Monitor diff and prevent regression
- **After write:** Run targeted verification, compare before/after quality score
- **Always:** Maintain quality trend chart per module

**Quality Score formula:**
```
Quality Score = (typecheck_before - typecheck_after) + 
                (lint_warnings_before - lint_warnings_after) + 
                (test_pass_rate_before - test_pass_rate_after)
Negative value = regression → BLOCK.
```

### 3.3 Automated Tech Debt Tracker

**Problem:** Tech debt accumulates without systematic monitoring.

**Solution:** Enhance `todo-checker` agent into **debt-tracker**:
- Classify TODOs: `TYPE:bug|enhancement|refactor|documentation` + `SEVERITY:critical|major|minor`
- Track age of each TODO (auto-aging)
- Generate tech debt dashboard per sprint
- **NEW:** Debt budget enforcement — if debt > threshold (e.g., 20 TODOs), block new feature addition

**Tech debt report:**
```
## Tech Debt Report — Module: user-service
| Todo | Age | Type | Severity | 
|------|-----|------|----------|
| Fix input validation | 45d | bug | CRITICAL |
| Add error handling | 30d | enhancement | MAJOR |
| Refactor helper | 10d | refactor | MINOR |

Total Debt: 3 items (1 CRITICAL, 1 MAJOR, 1 MINOR)
Debt Score: 27/100 ⚠️ (blocked: threshold 25 exceeded)
```

### 3.4 Consistency Enforcement Agent

**Problem:** Developers (human or AI) are often inconsistent in naming, structure, patterns.

**Solution:** **`consistency-enforcer`** agent that:
- Define "project pattern profile" from existing code
- Validate new code against profile
- Flag inconsistencies: "This controller uses `findAll()` but the project convention is `list()`"
- Auto-suggest fixes based on dominant pattern

**Pattern profile auto-detect:**
```typescript
// From scanning existing code, detect:
{
  namingConventions: {
    controllers: "PascalCase + Controller",
    services: "PascalCase + Service",
    files: "kebab-case"
  },
  importStyle: "named exports preferred",
  errorHandling: "custom Error classes + middleware",
  fileOrganization: "feature-first"
}
```

### 3.5 Proactive Bug Hunter

**Problem:** Bugs are found in review/test, when they could be prevented earlier.

**Solution:** **`bug-hunter`** agent that runs *alongside* implementation:
- Scan every diff for common bug patterns
- Null check: all nullable values handled?
- Error handling: every Promise has .catch()?
- Boundary: array access, negative numbers, empty states?
- Security: SQL injection, XSS, auth bypass patterns

**Integration:** Run as a parallel subagent during implementation.

### 3.6 Automatic Quality Checklist on Stop

**Problem:** Currently `Stop` hook only auto-commits and updates the graph.

**Solution:** Enhance `Stop` hook to:
1. **Quality Gate:** Run typecheck + lint + test on changed files
2. **Debt Check:** Check if any new TODO/FIXME were added
3. **Regression Check:** Compare with before changes (from git stash)
4. **Memory Check:** Are there important decisions not yet recorded?
5. **Health Report:** Output quality summary

---

## 🔄 Recommended Implementation Priority

### Week 1-2: Foundations (DILIGENT)
1. **Pre-Flight Checklist** (3.1) — hooks enhancement, fastest impact
2. **Quality Guardian Agent** (3.2) — agent definition + basic hooks
3. **Consistency Enforcer** (3.4) — pattern detection

### Week 3-4: Memory & Learning (LEARN)
4. **Experience Journal Agent** (1.1) — new agent + post-task hook
5. **Cross-Session Consolidation** (1.3) — SessionEnd enhancement
6. **Success Pattern Recognition** (1.2) — learn.ts enhancement

### Week 5-6: Wisdom Layer (WISE)
7. **Risk-Aware Execution** (2.1) — pre-task assessment
8. **Lite-ADR System** (2.2) — decision snapshots
9. **Trade-off Analysis** (2.3) — agent definition
10. **User Preference Profile** (1.4) — profiling system

### Week 7-8: Advanced + Polish
11. **Proactive Bug Hunter** (3.5) — parallel scanning
12. **Automated Post-mortem** (2.4)
13. **Stop Quality Gate** (3.6) — enhanced hook
14. **Tech Debt Tracker** (3.3) — dashboard + budget enforcement

---

## 📈 Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| **Bug escape rate** | High (bugs found in review/test) | Low (caught before write) |
| **Context switch cost** | High (every session starts from zero) | Low (automatic memory recall) |
| **Decision consistency** | Varies per task | Standardized with trade-off docs |
| **Code consistency** | Inconsistent patterns | Project profile enforcement |
| **Tech debt awareness** | None | Tracked + budgeted |
| **Learning velocity** | Every session re-learns | Knowledge accumulation |
| **Diligence** | Reactive (problems first, then check) | Proactive (prevent before occurrence) |

---

## 🏗️ Implementation Pattern

For each new feature, follow the existing plugin pattern:

```
agents/<feature-name>.md        → Agent definition (frontmatter + system prompt)
commands/<feature-name>.md      → Slash command mapping
src/<feature>.ts                → Implementation logic
hooks/hooks.json                → Hook integration (auto-trigger)
```

### Shared Anti-Lazy Directive
All new agents must inherit the `_shared/OVERPOWERED.md` directive:
1. **Absolute Anti-Reductionism** — don't oversimplify
2. **Over-Engineering Mandate** — prefer robust solution
3. **Zero Suppression** — fix root cause, don't suppress
4. **No Dummy Code** — all real solutions, no placeholders
5. **Strict Anti-Speculation** — don't hallucinate

---

## 📋 Summary: 3 Pillars, 14 Features

| Pillar | Feature | Type | Impact |
|--------|---------|------|--------|
| 🧠 **LEARN** | Experience Journal | New Agent | High |
| 🧠 **LEARN** | Success Pattern Recognition | Enhancement | Medium |
| 🧠 **LEARN** | Cross-Session Consolidation | Hook Enhancement | High |
| 🧠 **LEARN** | User Preference Profile | New System | Medium |
| 🎯 **WISE** | Risk-Aware Execution | Hook Enhancement | High |
| 🎯 **WISE** | Lite-ADR System | New CLI + Agent | Medium |
| 🎯 **WISE** | Trade-off Analysis | New Agent | Medium |
| 🎯 **WISE** | Knowledge Integration | Agent + Context7 | Medium |
| ⚡ **DILIGENT** | Pre-Flight Checklist | Hook Enhancement | High |
| ⚡ **DILIGENT** | Quality Guardian | New Agent | High |
| ⚡ **DILIGENT** | Tech Debt Tracker | Enhancement | Medium |
| ⚡ **DILIGENT** | Consistency Enforcer | New Agent | Medium |
| ⚡ **DILIGENT** | Proactive Bug Hunter | Parallel Agent | High |
| ⚡ **DILIGENT** | Stop Quality Gate | Hook Enhancement | High |

---

> **Conclusion:** The coder-workflow plugin already has a strong foundation (hooks, agents, memory, orchestrator). What's missing is the **learning loop** (experience → memory → wisdom), **proactive quality**, and **decision intelligence**. With these 14 features, the AI agent will not work like a fresh graduate every time, but like a senior engineer who learns from every experience.
