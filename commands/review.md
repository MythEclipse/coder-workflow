---
description: Code review — security audit, edge-case detection, peer review
argument-hint: [diff-ref-or-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(code-review): Security audit + edge-case review

∴ Workflow({
  name: 'code-review',
  description: 'Multi-angle code review: security, edge cases, logic, style, architecture impact',
  phases: [
    { title: 'Scope',     detail: 'resolve diff/scope via CodeGraph + git diff' },
    { title: 'Review',    detail: 'parallel: security scan + logic review + impact radius' },
    { title: 'Synthesize', detail: 'merge findings, rank by severity, produce review report' },
  ],
})

phase('Scope')
const [diffContext, impactMap] = await parallel([
  () => agent(
    `Resolve review scope: ${$ARGUMENTS || 'recent changes (HEAD vs main)'}.
    Get git diff, identify changed files, summarize what changed.`,
    { label: 'diff-scope', phase: 'Scope', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__analyze_impact on changed files.
    Return downstream modules affected, potential regression surface.
    Scope: ${$ARGUMENTS || 'HEAD vs main'}`,
    { label: 'impact-map', phase: 'Scope', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Review')
const [securityFindings, logicFindings, styleFindings] = await parallel([
  () => agent(
    `Security review: scan for injection vulnerabilities, auth bypasses, sensitive data exposure,
    insecure defaults, OWASP Top 10 issues, hardcoded secrets.
    Diff: ${diffContext}`,
    { label: 'security-review', phase: 'Review', agent: 'coder-workflow:code-reviewer' }
  ),
  () => agent(
    `Logic review: identify edge cases not handled, null-deref risks, off-by-one errors,
    incorrect error handling, race conditions, improper state management.
    Diff: ${diffContext}
    Impact: ${impactMap}`,
    { label: 'logic-review', phase: 'Review', agent: 'coder-workflow:code-reviewer' }
  ),
  () => agent(
    `Style + architecture review: naming inconsistencies, violation of existing patterns,
    missing abstractions, premature optimization, over-engineering.
    Diff: ${diffContext}`,
    { label: 'style-review', phase: 'Review', agent: 'coder-workflow:architecture-auditor' }
  ),
])

phase('Synthesize')
const report = await agent(
  `Merge all review findings into a single structured report:
  - CRITICAL / HIGH (must fix before merge)
  - MEDIUM (should fix)
  - LOW / SUGGESTION (optional)
  - APPROVED items (explicitly good patterns worth noting)
  Security: ${securityFindings}
  Logic: ${logicFindings}
  Style: ${styleFindings}`,
  { label: 'review-report', phase: 'Synthesize' }
)

return { report, verdict: report.hasCritical ? 'CHANGES_REQUESTED' : 'APPROVED' }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
> - `mcp__codegraph__analyze_impact` now has UNLIMITED depth.
