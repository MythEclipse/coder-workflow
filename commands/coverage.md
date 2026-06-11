---
description: Aggregate test coverage reports — jest, vitest, go test, pytest
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(coverage-aggregate): Aggregate + analyze test coverage

∴ Workflow({
  name: 'coverage-aggregate',
  description: 'Aggregate coverage reports, identify gaps, track coverage trend',
  phases: [
    { title: 'Collect', detail: 'parallel: run tests + read existing reports' },
    { title: 'Analyze', detail: 'identify uncovered paths + trend vs previous run' },
    { title: 'Report',  detail: 'coverage dashboard + gap priority list' },
  ],
})

phase('Collect')
const [currentCoverage, historicalCoverage] = await parallel([
  () => agent(
    `Run mcp__codegraph__aggregate_coverage on scope: ${$ARGUMENTS || 'full project'}.
    Also check for existing coverage JSON files (coverage/lcov.info, coverage-summary.json).
    Return: per-file line/branch/function coverage percentages.`,
    { label: 'current-coverage', phase: 'Collect', agent: 'coder-workflow:test-engineer' }
  ),
  () => agent(
    `Read previous coverage report if cached (from last run or CI artifacts).
    Return baseline percentages for delta comparison.`,
    { label: 'historical-coverage', phase: 'Collect', agent: 'coder-workflow:test-engineer' }
  ),
])

phase('Analyze')
const analysis = await agent(
  `Analyze coverage:
  - Overall: lines, branches, functions, statements %
  - Delta vs previous run (regression detection)
  - Files with 0% coverage (no tests at all)
  - Files with <50% coverage (critical gaps)
  - Coverage threshold check (target: ≥80% lines)
  Current: ${currentCoverage}
  Historical: ${historicalCoverage}`,
  { label: 'coverage-analysis', phase: 'Analyze', agent: 'coder-workflow:test-engineer' }
)

phase('Report')
const report = await agent(
  `Coverage report:
  1. Overall status: PASS (≥80%) / WARN (60-79%) / FAIL (<60%)
  2. Top 10 files by gap (most lines uncovered)
  3. Coverage regressions vs previous run
  4. Quick wins: files near 80% threshold
  Analysis: ${analysis}`,
  { label: 'coverage-report', phase: 'Report' }
)

return { report }
```
