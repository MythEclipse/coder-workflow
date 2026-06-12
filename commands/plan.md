---
description: Decompose a coding request into many small tracked tasks. Invokes the built-in planner with the workflow-planner skill for aggressive task decomposition with skill/MCP routing for each task.
argument-hint: [task-description]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(task-decomposition): Decompose request into tracked atomic tasks

∴ Workflow({
  name: 'task-decomposition',
  description: 'Aggressively decompose coding request into N atomic tasks with skill/agent routing',
  phases: [
    { title: 'Discover', detail: 'CodeGraph recon — understand current codebase state' },
    { title: 'Plan',     detail: 'built-in planner decomposes into atomic tasks with FILE_MANIFEST' },
    { title: 'Register', detail: 'create TaskCreate entries for each decomposed task' },
  ],
})

phase('Discover')
const exploration = await agent(
  `Explore codebase to understand the current state relevant to this request: $ARGUMENTS
  Use CodeGraph to map affected modules, trace dependencies, identify integration points.`,
  { label: 'pre-explore', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
)

phase('Plan')
const decomposition = await agent(
  `Aggressively decompose this request into atomic tasks. Each task must:
  - Target ≤3 files (FILE_MANIFEST)
  - Have a single, measurable output
  - Be assignable to exactly one specialist agent from the routing table
  - Have explicit dependencies declared (so parallel vs sequential is clear)

  Request: $ARGUMENTS
  Codebase context: ${exploration}

  Output: ordered task list with FILE_MANIFEST, agent assignment, and dependency graph.`,
  { label: 'decompose', phase: 'Plan', skill: 'workflow-planner' }
)

phase('Register')
const taskList = await agent(
  `For each task in the decomposition, run TaskCreate to register it in the task tracker.
  Then output a final summary table: task name | agent | files | depends-on.
  Decomposition: ${decomposition}`,
  { label: 'register-tasks', phase: 'Register' }
)

return { taskList, decomposition }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via `coder-workflow:explore-codebase` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
