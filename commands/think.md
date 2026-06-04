---
description: Start a sequential thinking session — structured, multi-step reasoning with branching, revision, and export.
argument-hint: [thought]
agent: general-purpose
allowed-tools: mcp__codegraph__sequential_thinking*, mcp__codegraph__sequential_thinking_export*, mcp__codegraph__sequential_thinking_list*, mcp__codegraph__sequential_thinking_reset*
---

# Sequential Thinking

Use this skill when you need to break down a complex problem through structured, step-by-step reasoning. Each thought builds on, revises, or branches from previous insights.

## Available Tools

| MCP Tool | Description |
|---|---|
| `sequential_thinking` | Submit a single thinking step with branching/revision support |
| `sequential_thinking_export` | Export session as Markdown, ASCII tree, or Mermaid diagram |
| `sequential_thinking_list` | List all persisted sessions |
| `sequential_thinking_reset` | Clear current session and start fresh |

## Usage in Sessions

1. **Start a session** — Use `sequential_thinking` with your first thought
2. **Build iteratively** — Submit follow-up thoughts, adjust `totalThoughts` as needed
3. **Revise if needed** — Use `isRevision: true` + `revisesThought` to correct previous steps
4. **Branch for alternatives** — Use `branchFromThought` + `branchId` to explore parallel paths
5. **Export when done** — Use `sequential_thinking_export` with format: `markdown`, `tree`, `mermaid`, or `summary`
6. **Reset** — Use `sequential_thinking_reset` to clear state for a new problem

## Example Flow

```
Thought 1: "Analyze the user auth flow..."
Thought 2: "Revision: Actually, we need to consider OAuth as well..." (isRevision, revisesThought: 1)
Thought 3: "Alternative: what if we use session-based auth instead?" (branchFromThought: 1, branchId: "session-auth")
Thought 4: "Conclusion: JWT + OAuth hybrid is best..." (nextThoughtNeeded: false)
→ Export as Markdown for documentation
```
