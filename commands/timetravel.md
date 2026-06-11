---
description: Git bisect + rollback — identify the commit introducing a regression and revert safely
argument-hint: [bad-commit-or-regression-description]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(bisect-rollback): Git bisect regression hunt + safe rollback

∴ Workflow({
  name: 'bisect-rollback',
  description: 'Find regression-introducing commit, assess rollback safety, execute revert',
  phases: [
    { title: 'Bisect',   detail: 'git bisect to find first-bad commit' },
    { title: 'Assess',   detail: 'parallel: impact radius + rollback safety + cherry-pick candidates' },
    { title: 'Rollback', detail: 'safe revert or targeted fix' },
    { title: 'Verify',   detail: 'confirm regression fixed, no new breakage' },
  ],
})

phase('Bisect')
const bisectResult = await agent(
  `Run git bisect to find the first commit introducing: $ARGUMENTS
  Strategy:
  1. git bisect start
  2. Mark current HEAD as bad
  3. Mark last known good commit as good
  4. Test each bisect step
  Return: first-bad commit SHA + commit message + author + date.`,
  { label: 'git-bisect', phase: 'Bisect', agent: 'coder-workflow:rollback-engineer' }
)

phase('Assess')
const [impactRadius, rollbackSafety, cherryPicks] = await parallel([
  () => agent(
    `Run mcp__codegraph__analyze_impact on files changed in: ${bisectResult.sha}.
    Return: downstream impact, risk surface of rolling back.`,
    { label: 'impact-radius', phase: 'Assess', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Assess rollback safety: what other commits built on top of ${bisectResult.sha}?
    Are there data migrations that cannot be rolled back?
    Return: SAFE / RISKY / DANGEROUS with reasons.`,
    { label: 'rollback-safety', phase: 'Assess', agent: 'coder-workflow:rollback-engineer' }
  ),
  () => agent(
    `Identify cherry-pick candidates: commits after ${bisectResult.sha} that should be preserved.
    Return: list of SHA + reason for each.`,
    { label: 'cherry-picks', phase: 'Assess', agent: 'coder-workflow:rollback-engineer' }
  ),
])

phase('Rollback')
const rollback = await agent(
  `Execute rollback strategy based on safety assessment:
  - SAFE: git revert ${bisectResult.sha}
  - RISKY: targeted patch to fix only the regression, not full revert
  - DANGEROUS: document risk, propose minimal surgical fix
  First-bad commit: ${bisectResult.sha}
  Safety: ${rollbackSafety}
  Cherry-picks to preserve: ${cherryPicks}`,
  { label: 'execute-rollback', phase: 'Rollback', agent: 'coder-workflow:rollback-engineer' }
)

phase('Verify')
const verify = await agent(
  `Verify regression is fixed:
  - Reproduce original failing scenario — confirm it now passes
  - Run full test suite — no new failures
  - Check cherry-picked commits are intact
  Rollback applied: ${rollback}`,
  { label: 'rollback-verify', phase: 'Verify', agent: 'coder-workflow:test-engineer' }
)

return { bisectResult, rollback, verify }
```
