---
description: Code review — security audit, edge-case detection, peer review
argument-hint: [diff-ref-or-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Scope
Run concurrently:
  - Resolve review scope: [results from previous phase]. Get git diff, identify changed files, summarize what changed.,
  - Run your graph/mapping tools on changed files. Return downstream modules affected, potential regression surface. Scope: [results from previous phase],

### Phase: Review
Run concurrently:
  - Security review: scan for injection vulnerabilities, auth bypasses, sensitive data exposure, insecure defaults, OWASP Top 10 issues, hardcoded secrets. Diff: [results from previous phase],
  - Logic review: identify edge cases not handled, null-deref risks, off-by-one errors, incorrect error handling, race conditions, improper state management. Diff: [results from previous phase] Impact: [results from previous phase],
  - Style + architecture review: naming inconsistencies, violation of existing patterns, missing abstractions, premature optimization, over-engineering. Diff: [results from previous phase],

### Phase: Synthesize
- Merge all review findings into a single structured report: - CRITICAL / HIGH (must fix before merge) - MEDIUM (should fix) - LOW / SUGGESTION (optional) - APPROVED items (explicitly good patterns worth noting) Security: [results from previous phase] Logic: [results from previous phase] Style: [results from previous phase]

```

