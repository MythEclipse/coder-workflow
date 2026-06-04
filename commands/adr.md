---
description: Architecture Decision Records — create, list, manage, graph ADRs
argument-hint: [new|list|get|status|graph|init]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
---
Invoke the `docs-generator` agent for ADR management. Commands:
- `coder-workflow adr init` — initialize ADR directory
- `coder-workflow adr new --title "..."` — create ADR
- `coder-workflow adr list` — list all ADRs
- `coder-workflow adr status <id> --status accepted` — update status
- `coder-workflow adr graph` — Mermaid relationship diagram
Or via MCP: `adr_new`, `adr_list`, `adr_get`, `adr_status`, `adr_graph`.
