---
description: Generate comprehensive test suites and ensure TDD compliance
argument-hint: [target-files]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:test-engineer` subagent to write tests for the specified scope.

Pass the target files or components to the agent. The agent will handle ecosystem detection and test scaffolding autonomously.
