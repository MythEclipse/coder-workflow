---
description: Start a sequential thinking session — structured, multi-step reasoning with branching, revision, and export.
argument-hint: [thought]
agent: general-purpose
allowed-tools: mcp__codegraph__sequential_thinking*, mcp__codegraph__sequential_thinking_export*, mcp__codegraph__sequential_thinking_list*, mcp__codegraph__sequential_thinking_reset*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(sequential-think): Structured multi-step reasoning with branching

∴ Workflow({
  name: 'sequential-think',
  description: 'Sequential reasoning session for: $ARGUMENTS',
  phases: [
    { title: 'Think',  detail: 'iterative thought chain via sequential_thinking MCP tool' },
    { title: 'Export', detail: 'export final reasoning as markdown/tree/mermaid' },
  ],
})

phase('Think')
// Use sequential_thinking MCP tool for each thought step:
// - mcp__codegraph__sequential_thinking: submit a single thought with branching/revision
// - Set isRevision: true + revisesThought: N to correct previous steps
// - Set branchFromThought: N + branchId to explore alternatives
// - Continue until nextThoughtNeeded: false

const thinkingSession = await pipeline([
  () => agent(
    `Start a sequential thinking session for: $ARGUMENTS
    Use mcp__codegraph__sequential_thinking for each thought step.
    Build iteratively: each thought should refine, revise, or branch.
    Stop when you reach a conclusion (nextThoughtNeeded: false).`,
    { label: 'think-steps', phase: 'Think' }
  ),
])

phase('Export')
const exported = await agent(
  `Export the completed thinking session.
  Use mcp__codegraph__sequential_thinking_export with format: markdown
  Also provide tree format if branching was used.
  Session: ${thinkingSession}`,
  { label: 'export-thinking', phase: 'Export' }
)

return { exported, session: thinkingSession }
```

## Sequential Thinking MCP Tools

| MCP Tool | Description |
|---|---|
| `sequential_thinking` | Submit a single thinking step with branching/revision support |
| `sequential_thinking_export` | Export session as Markdown, ASCII tree, or Mermaid diagram |
| `sequential_thinking_list` | List all persisted sessions |
| `sequential_thinking_reset` | Clear current session and start fresh |
