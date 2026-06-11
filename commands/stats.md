---
description: Codebase statistics — LOC, language breakdown, file counts, trend analysis
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(codebase-stats): Codebase statistics and trend analysis

∴ Workflow({
  name: 'codebase-stats',
  description: 'LOC, language breakdown, file counts, growth trends',
  phases: [
    { title: 'Collect', detail: 'parallel: LOC + graph stats + git history trends' },
    { title: 'Report',  detail: 'structured stats dashboard' },
  ],
})

phase('Collect')
const [locStats, graphStats, gitTrends] = await parallel([
  () => agent(
    `Run mcp__codegraph__codebase_stats on scope: ${$ARGUMENTS || 'full project'}.
    Return: total LOC, language breakdown, file count by type, test ratio.`,
    { label: 'loc-stats', phase: 'Collect', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Get CodeGraph node/edge stats: total functions, classes, modules, call edges.
    Run mcp__codegraph__list_graph_stats if available.`,
    { label: 'graph-stats', phase: 'Collect', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Get git history stats: commits per week (last 12 weeks), top contributors by LOC,
    most frequently changed files, churn rate.
    Run: git log --stat --since=12.weeks`,
    { label: 'git-trends', phase: 'Collect', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Report')
const report = await agent(
  `Produce codebase stats dashboard:
  - Language breakdown chart (text)
  - LOC by module
  - Graph density (edges/nodes ratio)
  - Growth trend: LOC added/removed per week
  - Hot files: most changed, highest churn
  LOC: ${locStats}
  Graph: ${graphStats}
  Trends: ${gitTrends}`,
  { label: 'stats-report', phase: 'Report' }
)

return { report }
```
