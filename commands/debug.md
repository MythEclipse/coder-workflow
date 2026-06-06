---
description: Perform a systematic root-cause analysis and debug a specific issue
argument-hint: [issue-description]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:debugging-engineer` subagent to investigate and fix the provided issue.

Pass the issue description to the agent. The agent will handle the 4-phase root-cause analysis and bug fixing process.
