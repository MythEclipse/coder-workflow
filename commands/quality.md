---
description: Quality Guardian — check quality score, regression, trend
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:quality-guardian` subagent to enforce quality standards — detect code smell, best-practice violations, style inconsistencies, logic duplication, and architectural anomalies before code is merged.

The `coder-workflow:quality-guardian` agent is the single source of truth for quality rules, severity levels, audit process, and output contract. Do not duplicate those rules here — invoke the agent with the given scope and let it run its full process.

If a scope argument (file path, module name, or diff ref) is provided, pass it to the agent as the target boundary. If no argument, the agent will scan all recent changes against the full codebase.

CLI invocation: `coder-workflow quality [scope]`.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `Read` tool instead.
> - `mcp__codegraph__update_codebase` and `mcp__codegraph__diff_graphs` are available for partial graph updates and structural comparison.
> - Use `mcp__codegraph__analyze_quality` for graph-backed quality analysis, `mcp__codegraph__quality_gate` for gate evaluation, and `mcp__codegraph__find_dead_code`/`mcp__codegraph__find_cycles` for targeted scans.
