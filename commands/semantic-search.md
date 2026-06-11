---
description: Semantic search — find code by meaning, not just text matching
argument-hint: [search-query]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(semantic-search): Find code by meaning via CodeGraph embeddings

∴ Workflow({
  name: 'semantic-search',
  description: 'Semantic search for: $ARGUMENTS',
  phases: [
    { title: 'Search',  detail: 'parallel: semantic + graph + keyword search' },
    { title: 'Rank',    detail: 'merge + deduplicate + rank by relevance' },
  ],
})

phase('Search')
const [semanticHits, graphHits, keywordHits] = await parallel([
  () => agent(
    `Run mcp__codegraph__semantic_search with query: "$ARGUMENTS"
    Return top 10 results with similarity scores and file:line refs.`,
    { label: 'semantic', phase: 'Search', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__query_graph to find nodes matching: $ARGUMENTS
    Focus on function names, class names, module names.`,
    { label: 'graph-search', phase: 'Search', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Keyword grep for: $ARGUMENTS across source files.
    Return file:line matches with context (3 lines each).`,
    { label: 'keyword', phase: 'Search', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Rank')
const results = await agent(
  `Merge, deduplicate, and rank all search results by relevance to: $ARGUMENTS
  Semantic: ${semanticHits}
  Graph: ${graphHits}
  Keyword: ${keywordHits}
  Output: ranked list with file:line, code snippet, relevance score.`,
  { label: 'rank-results', phase: 'Rank' }
)

return { results }
```
