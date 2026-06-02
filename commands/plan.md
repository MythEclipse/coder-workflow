---
description: Decompose a coding request into many small tracked tasks. Invokes workflow-planner agent for aggressive task decomposition with skill/MCP routing for each task.
argument-hint: [task-description]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Invoke the `workflow-planner` agent (using the `Agent` or `Subagent` tool, DO NOT use the `Skill` tool) to aggressively decompose the given coding request.

The `workflow-planner` agent is the single source of truth for decomposition rules, task thresholds, dependency ordering, skill assignment, and verification gates. Do not duplicate those rules here — invoke the agent and let it run its full process.

Pass the user's task description directly to the agent. If no argument is provided, ask the user what they want to build or fix before invoking.


> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via explorer subagents instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
