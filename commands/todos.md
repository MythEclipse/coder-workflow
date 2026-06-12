---
description: TODO/FIXME/HACK tracking with author aging and priority ranking
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(todo-track): TODO/FIXME/HACK scan with age + priority

∴ Workflow({
  name: 'todo-track',
  description: 'Scan and age TODO/FIXME/HACK comments, rank by staleness and severity',
  phases: [
    { title: 'Scan',   detail: 'parallel: todo scan + git blame for age' },
    { title: 'Report', detail: 'age-sorted, priority-ranked report with TaskCreate' },
  ],
})

phase('Scan')
const [todoList, blameData] = await parallel([
  () => agent(
    `Run mcp__codegraph__scan_todos on scope: ${$ARGUMENTS || 'full project'}.
    Also grep for: TODO, FIXME, HACK, XXX, NOTE, BUG, WORKAROUND patterns.
    Return: file:line, comment text, category.`,
    { label: 'todo-scan', phase: 'Scan', skill: 'todo-checker' }
  ),
  () => agent(
    `Run git blame on all files containing TODOs. Extract: author, date, commit SHA.
    Identify TODOs older than 30 days (stale) and older than 90 days (critical tech debt).`,
    { label: 'blame-age', phase: 'Scan', skill: 'todo-checker' }
  ),
])

phase('Report')
const report = await agent(
  `Produce TODO report ranked by: age × severity
  Categories:
  - CRITICAL: FIXME/BUG older than 90 days
  - HIGH: HACK/WORKAROUND older than 30 days
  - MEDIUM: TODO older than 30 days
  - LOW: recent TODOs
  Create TaskCreate for all CRITICAL and HIGH items.
  TODOs: ${todoList}
  Age data: ${blameData}`,
  { label: 'todo-report', phase: 'Report', skill: 'todo-checker' }
)

return { report }
```
