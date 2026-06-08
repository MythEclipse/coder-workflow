---
description: Scan TODO/FIXME/HACK/NOTE comments with author aging
argument-hint: [scan|history]
allowed-tools: Read, Grep, Bash
---
Agent: `coder-workflow:todo-checker`
Invoke via CLI: `coder-workflow todos [scan|history] [--group-by type|file|author]`.
Or via MCP: `scan_todos`, `todo_history`.
