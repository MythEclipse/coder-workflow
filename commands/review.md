---
description: Perform a rigorous code review and security audit on the latest changes
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Invoke the `code-reviewer` subagent to audit recent changes.

The reviewer will analyze the diff or target scope to detect edge cases, logic flaws, and security vulnerabilities.
