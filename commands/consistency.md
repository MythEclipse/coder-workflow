---
description: Consistency Enforcer — validate code consistency against project patterns
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:quality-guardian` subagent to validate and enforce code consistency against the codebase's dominant patterns. (Consistency enforcement has been merged into quality-guardian.)

Use this command when:
- Checking naming consistency for files/folders/variables/functions/classes
- Ensuring new code follows existing codebase standards
- Before merging a PR for quality gate
- After a major refactor to verify uniformity
- Finding mixed conventions that need alignment

If an optional scope argument is given, limit the check to a specific scope (directory, module, or file pattern). Without an argument, the agent will scan the entire codebase.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it.
> - New tools: `mcp__codegraph__update_codebase`, `mcp__codegraph__diff_graphs`.
