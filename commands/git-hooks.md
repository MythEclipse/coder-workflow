---
description: Generate pre-commit, commit-msg, pre-push git hooks with validation
argument-hint: [scaffold|validate-msg]
allowed-tools: Bash, Write
---
Invoke via CLI: `coder-workflow hooks scaffold --hooks pre-commit,commit-msg,pre-push [--linter eslint]` or `coder-workflow hooks validate-msg "feat: add login"`.
Or via MCP: `scaffold_git_hooks`, `validate_commit_message`.
