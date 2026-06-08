---
description: Proactive Bug Hunter — scan code for common bug patterns
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:debugging-engineer` subagent to hunt, reproduce, classify, and document bugs across the codebase. (Bug hunting has been merged into debugging-engineer — use Phase 0 for discovery.)

Use this command when you want to:
- Find new bugs in the codebase systematically
- Verify reported bugs with reproduction steps
- Classify bug severity and type
- Track the bug lifecycle from open to verified-fixed
- Get structured bug reports before release

The Bug Hunter Agent runs 5 phases: exploration & detection, verification & reproduction, classification & severity, documentation & reporting, and lifecycle tracking. CRITICAL and HIGH bugs are delegated to `debugging-engineer` for root-cause analysis.

If a scope argument is given (e.g., module path or feature), the agent will limit the search to that area. If no argument is given, the agent will scan the entire codebase.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it.
> - New tools: `mcp__codegraph__update_codebase`, `mcp__codegraph__diff_graphs`.
