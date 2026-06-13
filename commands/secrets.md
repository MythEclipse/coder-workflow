---
description: Secrets scanner — detect hardcoded API keys, tokens, passwords, credentials
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Scan
Run concurrently:
  - Run your graph/mapping tools on source code files. Also grep for patterns: API_KEY, SECRET, TOKEN, PASSWORD, PRIVATE_KEY, aws_, ghp_, sk-. Scope: [results from previous phase],
  - Scan configuration files for secrets: .env*, config.json, *.yaml, *.toml, docker-compose. Check that sensitive values are not committed — only placeholders/references. Scope: [results from previous phase],
  - Scan git history (last 50 commits) for accidentally committed secrets. Use: git log --all --full-history --diff-filter=D -- '*.env' and git grep in past commits.,

### Phase: Triage
- Classify all findings: - CONFIRMED: real secret value (not a placeholder/reference) - LIKELY: high-entropy string matching secret patterns - FALSE_POSITIVE: test fixture, example value, or env var reference Source: [results from previous phase] Config: [results from previous phase] Git history: [results from previous phase]

### Phase: Report
- Produce final secrets report: 1. CONFIRMED secrets: file:line + rotation instructions 2. LIKELY secrets: file:line + confirmation needed 3. Git history leaks: commit SHA + affected secret type + git filter-repo remediation steps 4. Recommended: .gitignore additions, pre-commit hook setup Triage: [results from previous phase]

```

