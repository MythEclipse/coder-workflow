---
description: Validate .env, JSON, YAML configs against schema; detect missing env vars
argument-hint: [env|json|missing-env]
allowed-tools: Read, Bash
---
Invoke via CLI: `coder-workflow validate env --schema <file> [--env .env]` or `coder-workflow validate json --file <file> --schema <file>` or `coder-workflow validate missing-env --required KEY1,KEY2`.
Or via MCP: `validate_env_file`, `validate_json_file`, `detect_missing_env_vars`.
