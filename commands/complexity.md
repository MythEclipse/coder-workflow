---
description: Cyclomatic complexity analysis — find overly complex functions needing decomposition
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(complexity-audit): Cyclomatic complexity analysis

∴ Workflow({
  name: 'complexity-audit',
  description: 'Measure cyclomatic complexity, find hotspots, recommend decomposition',
  phases: [
    { title: 'Measure',  detail: 'parallel: complexity scan + call graph depth' },
    { title: 'Report',   detail: 'hotspot ranking + decomposition recommendations' },
  ],
})

phase('Measure')
const [complexityData, callDepth] = await parallel([
  () => agent(
    `Run mcp__codegraph__analyze_complexity on scope: ${$ARGUMENTS || 'full project'}.
    Return: cyclomatic complexity per function, sorted descending.
    Flag: CC>10 (HIGH), CC>20 (CRITICAL).`,
    { label: 'complexity-scan', phase: 'Measure', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Measure call graph depth for top-level entry points.
    Find functions with longest call chains (deep call stack = fragile).
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'call-depth', phase: 'Measure', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Report')
const report = await agent(
  `Complexity report:
  1. TOP 10 most complex functions (CC + file:line)
  2. Functions marked CRITICAL (CC>20): immediate decomposition needed
  3. Decomposition strategy per hotspot (extract method, strategy pattern, etc.)
  4. Call depth hotspots
  Complexity: ${complexityData}
  Call depth: ${callDepth}`,
  { label: 'complexity-report', phase: 'Report' }
)

return { report }
```
