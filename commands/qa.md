---
description: Codebase Q&A — answer any question about the codebase using CodeGraph RAG
argument-hint: [question]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine. For Q&A, Tier 1 applies since the scope is a single focused question.

```
∴ coder-orchestrator [T1] → Workflow(codebase-qa): Answer codebase question via CodeGraph RAG

∴ Workflow({
  name: 'codebase-qa',
  description: 'Answer: $ARGUMENTS',
  phases: [
    { title: 'Retrieve', detail: 'semantic search + graph traversal for relevant context' },
    { title: 'Answer',   detail: 'codebase-qa-agent synthesizes answer from retrieved context' },
  ],
})

phase('Retrieve')
const [semanticContext, graphContext] = await parallel([
  () => agent(
    `Semantic search for context relevant to this question: $ARGUMENTS
    Use mcp__codegraph__semantic_search with the question as query.
    Return top 5 most relevant code chunks with file:line references.`,
    { label: 'semantic-retrieve', phase: 'Retrieve', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Graph-based context retrieval for: $ARGUMENTS
    Use mcp__codegraph__query_graph and mcp__codegraph__traverse_graph to find
    all nodes, edges, and modules directly relevant to the question.`,
    { label: 'graph-retrieve', phase: 'Retrieve', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Answer')
const answer = await agent(
  `Answer this codebase question with precision and file:line citations:
  Question: $ARGUMENTS

  Retrieved context:
  Semantic: ${semanticContext}
  Graph: ${graphContext}

  Rules:
  - Cite specific file:line for every claim
  - If uncertain, say so explicitly — do NOT hallucinate
  - If the question reveals a bug or gap, note it as a side finding`,
  { label: 'qa-answer', phase: 'Answer', skill: 'codebase-qa-agent' }
)

return { answer }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
