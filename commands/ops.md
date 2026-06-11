---
description: Sprint metrics, team velocity, benchmark recording, auto-merge ops
argument-hint: [ops-task]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(ops-sprint): Sprint report + metrics + benchmarks

∴ Workflow({
  name: 'ops-sprint',
  description: 'Sprint metrics, team velocity, benchmark recording for: $ARGUMENTS',
  phases: [
    { title: 'Gather',  detail: 'parallel: sprint data + benchmark history + team metrics' },
    { title: 'Analyze', detail: 'compute velocity, trend, regression detection' },
    { title: 'Report',  detail: 'sprint dashboard + action items' },
  ],
})

phase('Gather')
const [sprintData, benchmarks, teamMetrics] = await parallel([
  () => agent(
    `Run mcp__codegraph__sprint_report for current sprint.
    Include: completed tasks, open tasks, blocked items, scope changes.`,
    { label: 'sprint-data', phase: 'Gather', agent: 'coder-workflow:devops-engineer' }
  ),
  () => agent(
    `Run mcp__codegraph__record_benchmark to capture current performance baselines.
    Compare with previous run if available.`,
    { label: 'benchmarks', phase: 'Gather', agent: 'coder-workflow:devops-engineer' }
  ),
  () => agent(
    `Run mcp__codegraph__team_metrics: commits per author, PR cycle time, review turnaround.`,
    { label: 'team-metrics', phase: 'Gather', agent: 'coder-workflow:devops-engineer' }
  ),
])

phase('Analyze')
const analysis = await agent(
  `Analyze sprint health:
  - Velocity trend (improving/declining/stable)
  - Benchmark regressions vs previous sprint
  - Team balance: over/under-loaded members
  Sprint: ${sprintData}
  Benchmarks: ${benchmarks}
  Team: ${teamMetrics}`,
  { label: 'sprint-analysis', phase: 'Analyze', agent: 'coder-workflow:devops-engineer' }
)

phase('Report')
const report = await agent(
  `Produce sprint dashboard: velocity, benchmark delta, team health, top blockers, next sprint recommendations.
  Analysis: ${analysis}`,
  { label: 'sprint-report', phase: 'Report' }
)

return { report }
```
