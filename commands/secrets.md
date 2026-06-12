---
description: Secrets scanner — detect hardcoded API keys, tokens, passwords, credentials
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(secrets-scan): Detect hardcoded secrets across codebase

∴ Workflow({
  name: 'secrets-scan',
  description: 'Scan for hardcoded API keys, tokens, passwords, credentials',
  phases: [
    { title: 'Scan',    detail: 'parallel secrets scan: source code + config + history' },
    { title: 'Triage',  detail: 'classify findings: confirmed secret vs false positive' },
    { title: 'Report',  detail: 'severity-ranked findings + remediation steps' },
  ],
})

phase('Scan')
const [sourceSecrets, configSecrets, gitHistory] = await parallel([
  () => agent(
    `Run mcp__codegraph__scan_secrets on source code files.
    Also grep for patterns: API_KEY, SECRET, TOKEN, PASSWORD, PRIVATE_KEY, aws_, ghp_, sk-.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'source-scan', phase: 'Scan', skill: 'secret-scanner' }
  ),
  () => agent(
    `Scan configuration files for secrets: .env*, config.json, *.yaml, *.toml, docker-compose.
    Check that sensitive values are not committed — only placeholders/references.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'config-scan', phase: 'Scan', skill: 'secret-scanner' }
  ),
  () => agent(
    `Scan git history (last 50 commits) for accidentally committed secrets.
    Use: git log --all --full-history --diff-filter=D -- '*.env' and git grep in past commits.`,
    { label: 'git-history-scan', phase: 'Scan', skill: 'secret-scanner' }
  ),
])

phase('Triage')
const triage = await agent(
  `Classify all findings:
  - CONFIRMED: real secret value (not a placeholder/reference)
  - LIKELY: high-entropy string matching secret patterns
  - FALSE_POSITIVE: test fixture, example value, or env var reference
  Source: ${sourceSecrets}
  Config: ${configSecrets}
  Git history: ${gitHistory}`,
  { label: 'secrets-triage', phase: 'Triage', skill: 'secret-scanner' }
)

phase('Report')
const report = await agent(
  `Produce final secrets report:
  1. CONFIRMED secrets: file:line + rotation instructions
  2. LIKELY secrets: file:line + confirmation needed
  3. Git history leaks: commit SHA + affected secret type + git filter-repo remediation steps
  4. Recommended: .gitignore additions, pre-commit hook setup
  Triage: ${triage}`,
  { label: 'secrets-report', phase: 'Report' }
)

return { report, confirmedCount: triage.confirmed, gitLeaks: triage.gitLeaks }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
