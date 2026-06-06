---
description: Run a read-only architecture audit of the current project. Checks for fat controllers, missing repositories, schema-less boundaries, layer leakage, cross-module leaks, and circular dependencies.
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:architecture-auditor` agent to perform a comprehensive read-only architecture audit.

The `coder-workflow:architecture-auditor` agent is the single source of truth for violation definitions, severity levels, audit process, and output format. Do not duplicate those rules here — invoke the agent with the given scope and let it run its full process.

If a scope argument is provided, pass it to the agent as the audit boundary. If no argument, the agent will scan the full project.


> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via explorer subagents instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
