---
description: Compare OpenAPI specs, detect breaking API changes
argument-hint: [diff|git-diff]
allowed-tools: Bash, Read
---
Agent: `Explore`
Invoke via CLI: `coder-workflow api-contract diff --before <file> --after <file>` or `coder-workflow api-contract git-diff [--ref1 <ref>] [--ref2 <ref>]`.
Or via MCP: `compare_api_specs`, `diff_api_from_git`.
