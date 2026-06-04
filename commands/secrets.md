---
description: Scan codebase for hardcoded secrets, API keys, and tokens
allowed-tools: Bash, Grep, Glob
---
Invoke the `secret-scanner` agent to scan for secrets. Run `coder-workflow secrets` or MCP tool `scan_secrets`. High severity findings should block commits.
