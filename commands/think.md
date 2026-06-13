---
description: Start a sequential thinking session — structured, multi-step reasoning with branching, revision, and export.
argument-hint: [thought]
agent: general-purpose
allowed-tools: graph/mapping tools*, graph/mapping tools*, graph/mapping tools*, graph/mapping tools*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Think
// Use sequential_thinking MCP tool for each thought step:
// - graph/mapping tools: submit a single thought with branching/revision
// - Set isRevision: true + revisesThought: N to correct previous steps
// - Set branchFromThought: N + branchId to explore alternatives
// - Continue until nextThoughtNeeded: false

Run sequentially:
  - Start a sequential thinking session for: $ARGUMENTS Use your graph/mapping tools for each thought step. Build iteratively: each thought should refine, revise, or branch. Stop when you reach a conclusion (nextThoughtNeeded: false).,

### Phase: Export
- Export the completed thinking session. Use your graph/mapping tools with format: markdown Also provide tree format if branching was used. Session: [results from previous phase]

```

## Sequential Thinking MCP Tools

| MCP Tool | Description |
|---|---|
| `sequential_thinking` | Submit a single thinking step with branching/revision support |
| `sequential_thinking_export` | Export session as Markdown, ASCII tree, or Mermaid diagram |
| `sequential_thinking_list` | List all persisted sessions |
| `sequential_thinking_reset` | Clear current session and start fresh |
