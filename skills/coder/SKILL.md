---
name: Coder Workflow
description: This skill should be used when the user asks to "implement this feature", "fix this bug", "work on this code", "buat workflow coding", "kerjakan task coding", or requests a coding workflow that needs planning, implementation, verification, and concise reporting.
version: 0.1.0
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(npm:*), Bash(node:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*), Bash(pytest:*), Bash(python:*), Bash(go:*), Bash(cargo:*)
---

Run a disciplined coding workflow for Claude Code sessions. Balance speed with safety: understand scope, plan when changes are significant, implement the smallest complete change, verify behavior, and report clearly.

## Planning rule

Use Claude Code built-in plan mode before non-trivial work: new features, architectural changes, multi-file edits, behavior changes, unclear requirements, or tasks with several valid approaches. Keep direct execution for trivial fixes, known single-file edits, typo fixes, or purely informational requests.

In plan mode, inspect the relevant code, identify the target files, define the implementation sequence, list verification commands, and request approval before editing.

## Default workflow

1. **Clarify the task**
   - Restate the intended outcome in one sentence when ambiguity exists.
   - Ask targeted questions only when a decision changes implementation.
   - Avoid broad questionnaires when the code can answer the question.

2. **Inspect current state**
   - Check project instructions and relevant files before editing.
   - Check git status before modifying files to avoid overwriting user work.
   - Use graph/code intelligence tools first for cross-file dependency, callers, routes, or architecture questions when available.

3. **Plan the change**
   - Identify files to edit and why.
   - Prefer existing patterns over new abstractions.
   - Avoid feature flags, compatibility shims, and defensive code for impossible internal states.
   - Validate only at system boundaries such as user input and external APIs.

4. **Implement narrowly**
   - Edit existing files where possible.
   - Keep changes scoped to the requested outcome.
   - Preserve public behavior unless explicitly changing it.
   - Avoid comments unless the reason is non-obvious.

5. **Verify**
   - Run the smallest relevant typecheck, lint, and test commands.
   - For UI work, run the app and manually exercise the changed path when feasible.
   - If verification cannot run, state exactly why and what remains unverified.

6. **Report**
   - Summarize changed files and verification in one or two concise paragraphs.
   - Include file references as `path:line` when discussing specific code.
   - Mention next steps only when they are actionable.

## Agent routing

Use bundled agents for larger work:

- `workflow-planner`: delegate decomposition and implementation strategy when scope is unclear or multi-file.
- `architecture-auditor`: delegate read-only architecture and layer violation audits.
- `code-implementer`: delegate scoped implementation only after a plan or explicit implementation target exists.

Do not delegate understanding completely. Provide agents with concrete goals, relevant files, expected output, and constraints.

## Safety constraints

- Do not run destructive git commands without explicit approval.
- Do not skip hooks or checks unless the user explicitly asks.
- Do not commit unless the user explicitly asks.
- Do not broaden the task into opportunistic refactors.
- Do not claim completion when tests or manual verification were not performed.

## Additional resources

- `references/workflow-checklist.md` provides a reusable checklist for implementation sessions.
