---
description: Generate PR descriptions, changelogs, and manage releases
argument-hint: [pr|changelog|release]
allowed-tools: Read, Bash
---
Invoke the `coder-workflow:docs-generator` agent for PR/changelog/release tasks. Commands:
- `coder-workflow pr` — generate PR description
- `coder-workflow changelog` — generate changelog
- `coder-workflow release <patch|minor|major>` — create release
Or via MCP: `generate_pr`, `generate_changelog`, `create_release`.
