---
description: Trigger auto-bisect to find when a bug was introduced
argument-hint: [failing-test-command]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Invoke the `rollback-engineer` subagent to perform a `git bisect` and resolve the failing issue.
