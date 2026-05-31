# Coder Workflow Checklist

Reusable checklist for implementation sessions in the coder-workflow plugin.

## Phase 0: Orchestrator Entry

- [ ] `coder-orchestrator` triggered — request classified and routed
- [ ] Tasks created via `TaskCreate` for every unit of work (right-sized: 1-3 simple, 3-8 feature, 10+ complex)
- [ ] Tasks ordered by dependency: foundation → schema → repository → service → controller → routes → integration → tests → verification

## Phase 1: Understand & Inspect

- [ ] Goal restated in one sentence when ambiguous
- [ ] git status checked — working tree clean or user confirmed uncommitted changes
- [ ] Codegraph MCP queried for cross-file relationships (`query_graph`, `analyze_impact`, `summarize_architecture`)
- [ ] Relevant files located via codegraph MCP, not raw grep/find
- [ ] Existing project patterns identified before writing new code

## Phase 2: Research Knowledge Gaps

- [ ] Unfamiliar frameworks/libraries researched via `context7` MCP
- [ ] Recent API changes or migrations checked via `WebSearch` if context7 insufficient
- [ ] Learnings documented for future session memory
- [ ] No guessing — every API call backed by documentation

## Phase 3: Plan (Non-Trivial Changes)

- [ ] Claude Code built-in plan mode entered for: new features, architectural changes, multi-file edits, behavior changes, unclear requirements
- [ ] Implementation sequence defined with file targets
- [ ] Verification commands identified per batch
- [ ] User approval received before editing (`ExitPlanMode`)
- [ ] Direct execution only for: trivial fixes, single-file edits, typo fixes, informational requests

## Phase 4: Implement

- [ ] Each task marked `in_progress` via `TaskUpdate` before starting
- [ ] Smallest complete change made per task
- [ ] Existing patterns followed over new abstractions
- [ ] No opportunistic refactors or scope expansion
- [ ] Public behavior preserved unless explicitly changed
- [ ] No suppression flags (@ts-ignore, eslint-disable) — root causes fixed
- [ ] No destructive git commands without explicit approval
- [ ] No hooks skipped unless user explicitly asked

## Phase 5: Verify Each Task

- [ ] Narrowest check run first (typecheck or single test file)
- [ ] Broader checks run after (full test suite, full lint)
- [ ] UI changes manually exercised in running app
- [ ] Verification failures create new tasks, not shortcuts
- [ ] No task marked `completed` without verification evidence
- [ ] Skipped checks reported with exact reason
- [ ] **Record ALL pre-existing issues found** — warnings, deprecations, console errors, type errors in files you didn't edit. Create `TaskCreate` entries for each.

## Phase 5b: Bug Discovery (During Verification)

- [ ] ALL pre-existing bugs recorded — NOT skipped
- [ ] Browser API deprecation warnings → `TaskCreate` with severity
- [ ] Console errors/warnings → `TaskCreate` with severity
- [ ] Type errors in untouched files → `TaskCreate` with severity
- [ ] Lint violations in unrelated files → `TaskCreate` with severity
- [ ] Runtime warnings, unhandled rejections → `TaskCreate` with severity
- [ ] Broken tests that pre-date changes → `TaskCreate` with severity
- [ ] **NEVER** dismiss as "not related to my changes" or "pre-existing, skipping"

## Phase 6: Bug Fix Phase (MANDATORY — Before Session End)

- [ ] All discovered bugs listed with severity, file:line, description
- [ ] **Category A (files I touched)**: ALL fixed — no deferral
- [ ] **Category B (files I did NOT touch)**: Up to 5 High/Medium fixed; beyond 5 → write to `.claude/deferred-bugs.json`
- [ ] Each bug fix verified independently
- [ ] Each bug-fix task marked `completed` with verification results
- [ ] **Session NOT complete** until all Category A bugs AND up to 5 Category B bugs (High/Medium) are fixed
- [ ] Remaining deferred bugs reported with: file:line, severity, category, deferral reason
- [ ] **Forbidden:** "pre-existing", "not related to my changes", "let me ignore these", "this was already broken"

## Phase 7: Complete & Report

- [ ] All tasks marked `completed` via `TaskUpdate`
- [ ] All bug-fix tasks marked `completed` via `TaskUpdate`
- [ ] Stale tasks cleaned up (deleted or completed)
- [ ] Changed files summarized with `path:line` references
- [ ] Verification results reported: commands run, outcomes
- [ ] Bug fix summary: how many found, how many fixed, what remains
- [ ] Next steps listed with clear ownership
- [ ] New learnings stored for future sessions
- [ ] No commit/push unless user explicitly asked

## Phase 8: Session Metrics (Optional)

- [ ] Record total tasks created and completed
- [ ] Record total bugs discovered and fixed
- [ ] Record agent invocations: which agents, how many, complexity mix
- [ ] Record review pass/fail ratio: how many tasks needed rework
- [ ] Record session duration and estimated token efficiency (simple tasks direct vs complex with full SDD)
- [ ] Note patterns: which tasks could have been simpler, which needed more decomposition
- [ ] Save metrics to `.claude/session-metrics.json` for trend tracking

## Red Flag Checks

- [ ] No "let me try the most likely answer" without research
- [ ] No single giant "implement X" task — all decomposed per complexity threshold
- [ ] No "I think this should work" without verification
- [ ] No raw grep/find when codegraph MCP was available
- [ ] No Explore agent used — all exploration via codegraph MCP tools
- [ ] No API assumptions without context7 documentation lookup
- [ ] No abandoned tasks without exhausting all options
- [ ] No skipped bugs — every discovered issue was tracked and fixed
- [ ] No "not related to my changes" — if you see it, you fix it
- [ ] No over-ceremony on simple tasks — right-sized to complexity
