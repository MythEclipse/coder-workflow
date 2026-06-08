---
description: Aggregate coverage reports from jest, vitest, istanbul; check thresholds
argument-hint: [check]
allowed-tools: Read, Bash
---
Agent: `coder-workflow:test-engineer`
Invoke via CLI: `coder-workflow coverage check --threshold 80 [--jest <file>] [--vitest <file>] [--lcov <file>]`.
Or via MCP: `aggregate_coverage`, `check_coverage_threshold`.
