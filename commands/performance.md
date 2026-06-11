---
description: Bundle analysis and performance auditing
argument-hint: [bundle|compare|report]
allowed-tools: Read, Bash
---
Agent: `coder-workflow:explore-codebase`
Invoke via CLI: `coder-workflow perf bundle [--stats <stats.json>]` or `coder-workflow perf compare --before <a.json> --after <b.json>` or `coder-workflow perf report`.
Or via MCP: `analyze_bundle`, `compare_bundles`, `generate_perf_report`.
