---
name: coder
description: This skill should be used when the user asks to "implement this feature", "fix this bug", "work on this code", "buat workflow coding", "kerjakan task coding", or requests a coding workflow that needs planning, implementation, verification, and concise reporting.
version: 0.2.0
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(npm:*), Bash(node:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*), Bash(pytest:*), Bash(python:*), Bash(go:*), Bash(cargo:*), mcp__codegraph__*, mcp__code-review-graph__*
---

Run a disciplined coding workflow for Claude Code sessions. Balance speed with safety: understand scope, plan when changes are significant, implement the smallest complete change, verify behavior, and report clearly.

## Core mandates

1. **Task tracking is mandatory.** Before running ANY other tools (such as Grep, ViewFile, run_command, or CodeGraph MCP tools) at the start of a session or task, you MUST first run `TaskCreate` to initialize workflow tracking. Create an initial task (e.g., 'Explore codebase and plan implementation') and set it to `in_progress` immediately using `TaskUpdate`. This prevents warnings about task tools not being used.
2. **Skills and MCP first.** Before implementing, check if a relevant skill exists (`coder-orchestrator` routing). Use codegraph MCP for cross-file lookups. Use context7 MCP for framework/library docs.
3. **Context Token Efficiency (Subagent First).** NEVER read large files, search extensively, or edit code directly in the main session. ALWAYS dispatch subagents (`explorer` for reading/searching, `code-implementer` for editing) to keep the main context token usage low and highly efficient.
4. **Research before guessing.** If unfamiliar with a framework, API, or pattern — query context7 MCP or WebSearch.
5. **Fix every discovered bug — Impact Radius Protocol.** When pre-existing bugs, warnings, or deprecation notices are found during implementation:
   - **Category A (files I touched)**: Fix ALL without exception. You MUST invoke the `systematic-debugging` skill to perform a 4-phase root-cause analysis before attempting any fixes.
   - **Category B (files I did NOT touch)**: Budget-capped at 5 High/Medium severity bugs per session. Beyond 5, write to `.claude/deferred-bugs.json` with file:line, severity, and reason. Never silently drop bugs. Always create `TaskCreate` entries for tracking.
   - This aligns with the orchestrator's Impact Radius Protocol. See `coder-orchestrator` for full details.

## Planning rule

Use Claude Code built-in plan mode before non-trivial work: new features, architectural changes, multi-file edits, behavior changes, unclear requirements, or tasks with several valid approaches. Keep direct execution for trivial fixes, known single-file edits, typo fixes, or purely informational requests.

In plan mode, inspect the relevant code, identify the target files, define the implementation sequence, list verification commands, and request approval before editing.

## Task tracking protocol

**Before any other tool usage (including file reads, search, or command execution):**
1. Initialize the session by running `TaskCreate` to create an initial task (e.g., "Explore codebase and plan implementation") and mark it `in_progress` via `TaskUpdate`. This must be done BEFORE using any other tools to avoid task warning alerts.
2. Decompose the primary task into specific units of work via `TaskCreate`.
3. Mark the active task `in_progress` via `TaskUpdate` before starting its implementation.
4. Complete the work.
5. Verify the work (typecheck, lint, test, manual check).
6. Mark task `completed` via `TaskUpdate` with verification results.

**Task granularity:** Each task should be completable and verifiable in one focused pass. If a task is too large, create sub-tasks. Target: one task per function, per bug fix, per test file, per refactor.

**Never accumulate stale tasks.** When scope changes, mark old tasks as completed or deleted. Clean up regularly.

## Default workflow

1. **Clarify the task**
   - Restate the intended outcome in one sentence when ambiguity exists.
   - Ask targeted questions only when a decision changes implementation.
   - Avoid broad questionnaires when the code can answer the question.

2. **Inspect current state**
   - Check git status before modifying files to avoid overwriting user work.
   - Check project instructions and relevant files before editing.

3. **Research knowledge gaps**
   - If the framework, library, or API is unfamiliar — use context7 MCP to query current documentation.
   - If recent changes or migration may apply — use WebSearch.
   - Document learnings for future reference.

4. **Plan the change (Anti-Reductionism)**
   - Identify files to edit and why.
   - Never oversimplify complex problems. Drill down to the absolute root cause.
   - Always prefer a robust, complex, and scalable solution over a fragile or overly simple one.
   - Do not hesitate to introduce new abstractions or complex logic if it genuinely solves the root architectural problem.

5. **Implement robustly (Anti-Lazy)**
   - Strictly prohibited from offering "shortcuts," "quick fixes," or "band-aid solutions".
   - **Zero Suppression Policy**: STRICTLY FORBIDDEN from using suppression flags or annotations to bypass checks (e.g., `// eslint-disable`, `@ts-ignore`). Fix the underlying logic instead.
   - Never use "dummy code", "mock code", or "simple placeholders" just to get things to compile. Build real, complex logic as required by the domain.
   - Preserve public behavior unless explicitly changing it.

6. **Verify**
   - Run the smallest relevant typecheck, lint, and test commands.
   - For UI work, run the app and manually exercise the changed path when feasible.
   - If verification cannot run, state exactly why and what remains unverified.
   - Do NOT claim completion when tests or verification were not performed.
   - **Record ALL pre-existing issues found** — warnings, deprecations, console errors, type errors in files you didn't edit. Create `TaskCreate` entries for each. Never dismiss as "not related to my changes."

6b. **Bug Fix Phase (MANDATORY)**
   - After all primary tasks complete, list all discovered bugs (severity, file:line, description)
   - Fix each in order: Blocker → High → Medium
   - Verify each fix independently
   - **Triage rule**: bugs split into two categories:
     - **Category A — bugs in files I touched**: Fix ALL, regardless of count, with one exception: **Technical Debt Timeout**. If fixing the bug uncovers a massive chain of legacy debt that blocks feature delivery, you may defer it by writing a detailed justification to `.claude/deferred-bugs.json`. Otherwise, you MUST invoke the `systematic-debugging` skill to perform a 4-phase root-cause analysis before attempting any fixes.
     - **Category B — bugs in files I did NOT touch** (pre-existing in unrelated code): Budget-capped at **5 per session**. Beyond 5, auto-defer with documentation. Session completes without user interruption.
   - Session is NOT complete until all Category A bugs AND up to 5 Category B bugs (High/Medium) are fixed
   - Report any remaining deferred bugs with: file:line, severity, category, reason for deferral
   - **Deferred bug protocol:** If the user says "defer" or "fix later" for a discovered bug, mark the task as `pending` (not deleted) and note the deferral reason. The bug stays tracked but does NOT block session completion. Deferred bugs appear in the final report.
   - **Auto-defer protocol:** If Category B bug count exceeds 5, write all remaining bugs to `.claude/deferred-bugs.json` for the next session. Never silently drop.
   - **Forbidden phrases:** "not related to my changes", "pre-existing, skipping", "let me focus on my task and ignore these"

7. **Report**
   - Summarize changed files and verification in one or two concise paragraphs.
   - Include file references as `path:line` when discussing specific code.
   - Mention next steps only when they are actionable.
   - Document any learnings that should be remembered for future sessions.

## Agent routing

Use bundled agents for larger work:

- `workflow-planner`: delegate decomposition and implementation strategy when scope is unclear or multi-file.
- `architecture-auditor`: delegate read-only architecture and layer violation audits.
- `code-implementer`: delegate scoped implementation only after a plan or explicit implementation target exists.
- `test-engineer`: delegate test generation, coverage gap detection, and test scaffolding after implementation or when user asks for tests.

Do not delegate understanding completely. Provide agents with concrete goals, relevant files, expected output, and constraints.

## Safety constraints

- Do not run destructive git commands without explicit approval.
- Do not skip hooks or checks unless the user explicitly asks.
- Do not commit unless the user explicitly asks.
- Do not broaden the task into opportunistic refactors.
- Do not claim completion when tests or manual verification were not performed.

## Additional resources

- `references/workflow-checklist.md` provides a reusable checklist for implementation sessions.


---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**


> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via explorer subagents instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
