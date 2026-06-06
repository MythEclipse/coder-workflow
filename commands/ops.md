---
description: Sprint reports, team metrics, benchmark tracking, auto-merge checks
argument-hint: [sprint|team-metrics|pr-check|benchmark]
allowed-tools: Bash, Read
---
Invoke the `coder-workflow:devops-engineer` agent for team/ops metrics. Commands:
- `coder-workflow sprint` — sprint report
- `coder-workflow team-metrics` — team dashboard
- `coder-workflow pr-check <number>` — auto-merge check
- `coder-workflow benchmark record --name <name> --duration <ms>` — track benchmark
- `coder-workflow benchmark history --name <name>` — view history
- `coder-workflow benchmark regression --name <name>` — detect regression
Or via MCP: `sprint_report`, `team_metrics`, `pr_auto_merge`, `record_benchmark`, `benchmark_history`, `benchmark_regression`.
