---
description: Decompose a coding request into many small tracked tasks. Invokes the built-in planner with the workflow-planner skill for aggressive task decomposition with skill/MCP routing for each task.
argument-hint: [task-description]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
- Explore codebase to understand the current state relevant to this request: $ARGUMENTS Use Graph-based MCP tools to map affected modules, trace dependencies, identify integration points.

### Phase: Plan
- Aggressively decompose this request into atomic tasks. Each task must: - Target ≤3 files (FILE_MANIFEST) - Have a single, measurable output - Be assignable to exactly one specialist agent from the routing table - Have explicit dependencies declared (so parallel vs sequential is clear)  Request: $ARGUMENTS Codebase context: [results from previous phase]  Output: ordered task list with FILE_MANIFEST, agent assignment, and dependency graph.

### Phase: Register
- For each task in the decomposition, run TaskCreate to register it in the task tracker. Then output a final summary table: task name | agent | files | depends-on. Decomposition: [results from previous phase]

```

