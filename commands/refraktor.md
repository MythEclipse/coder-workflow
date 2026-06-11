---
description: Refactor codebase to Modular MVC + Service + Repository architecture
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:refactoring-engineer` subagent to perform a comprehensive refactor to a Modular MVC architecture.

The `coder-workflow:refactoring-engineer` agent is the single source of truth for the layer migration rules, directory structures, and verification checks. Do not duplicate those rules here — invoke the agent with the given scope and let it run its full process.

If a scope argument is provided, pass it to the agent as the refactoring boundary. If no argument, the agent will scan the full project.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via `coder-workflow:explore-codebase` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
