# Core Protocols Reference

> Extended operational protocols loaded on-demand. Not injected into every orchestrator invocation — referenced from the main SKILL.md.

## Crash Recovery (on Session Resume)

When resuming a session after a disconnect or token limit:

1. **Check `task.md`**: If it exists, read it and identify unchecked items (`[ ]`). Resume from the first incomplete task.
2. **Check TaskList**: Run `TaskList` to find tasks with `in_progress` status. If found, verify whether they were actually completed and update accordingly.
3. **Check `.claude/deferred-bugs.json`**: If present, review deferred bugs from the prior session. Fix them as part of your first Bug Fix Phase.
4. **Check `.claude/agent-depth.lock`**: If it exists with depth > 0, a subagent crashed. Delete the lock file before spawning new agents.
5. **Verify graph freshness**: Run `check_graph_freshness` MCP tool. If stale (>120 min), re-scan before deep analysis.
6. **Check Memory Bank**: Re-read `.coder-memory/` if the previous session left specific lessons for resumption.
7. **Do NOT restart from scratch**: Pick up exactly where the checklist left off.

## Impact Radius Bug Discovery Mandate

**You operate under an Impact Radius Protocol with a unified triage system.**

1. **Declare Scope**: Define the files you intend to modify upfront (`FILE_MANIFEST`).
2. **Category A — Bugs Within Impact Radius**: If you encounter errors, type issues, or lint warnings **within your declared `FILE_MANIFEST`** or directly introduced by your changes, you must track them as low-priority tasks to be fixed at the end of the session to prevent feature starvation. You may defer them by writing a detailed justification to `.claude/deferred-bugs.json` if fixing uncovers massive legacy debt.
3. **Category B — Pre-existing Bugs Outside Impact Radius**: If a global typecheck reveals errors in untouched modules, apply a **budget-capped triage**:
   - Fix up to **5 High/Medium severity** Category B bugs per session.
   - Beyond 5, defer by writing to `.claude/deferred-bugs.json` with file:line, severity, and deferral reason.
   - Low severity Category B bugs are documented but do not block session completion.
   - **Never silently drop bugs.** Always record them as tracked tasks or deferred entries.
4. **External Dependencies Escaping**: If fixing a Category A bug requires modifying a closely coupled external file (e.g., updating an interface), you are permitted to add that file to your `FILE_MANIFEST` and fix it. If the fix requires widespread architectural changes outside your scope, REVERT your breaking change and document it as a blocker.
5. **Targeted Checks**: Always run verification commands tailored to your specific files (e.g., `npx eslint path/to/changed/file.ts` rather than `npm run lint`).
6. **Session Completion Rule**: Session is NOT complete until all Category A bugs AND up to 5 Category B bugs (High/Medium) are fixed. Any remaining deferred bugs appear in the final report.

## Wisdom & Failure Handling Protocol

1. **Anti-Loop Circuit Breaker**: If a specific task, bug fix, or test fails **3 times consecutively** after attempted fixes, you MUST STOP. Do not guess for a 4th time. Mark the task as `BLOCKED`, explain the failure succinctly, and ask the user for help.
2. **Knowledge Confidence Boundary**: Guessing is strictly prohibited. If your confidence regarding an API, framework convention, or syntax is below 95%, you MUST pause to search the documentation (via `context7` MCP or web search) BEFORE writing any code.
3. **State Reversion**: If the circuit breaker is triggered (you give up on a failed path), you MUST revert the files to their last known good state (e.g., using `git checkout` or `git reset --hard` for the affected files) so you do not leave the workspace dirty with broken experiments.
4. **Anti-Lazy & Anti-Reductionism Mandate**: Never oversimplify complex problems. Drill down to the absolute root cause. You are STRICTLY FORBIDDEN from offering "shortcuts," "quick fixes," "band-aid solutions", or "dummy code" just to make things compile. Never use suppression flags (e.g., `// eslint-disable`, `@ts-ignore`) to hide errors—fix the underlying logic. Always prefer a robust, complex solution over a fragile simple one.
