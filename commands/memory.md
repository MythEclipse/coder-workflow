---
description: Cross-agent memory — store, query, and sync persistent memories across agents
argument-hint: [store|query|stats|export|sync]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(memory-op): Cross-agent memory store/query/sync

∴ Workflow({
  name: 'memory-op',
  description: 'Cross-agent memory operation: $ARGUMENTS',
  phases: [
    { title: 'Execute', detail: 'memory-librarian performs the requested operation' },
  ],
})

phase('Execute')
const result = await agent(
  `Perform cross-agent memory operation: $ARGUMENTS

  Available operations:
  - store: mcp__codegraph__store_memory {name, description, content, agent}
  - query: mcp__codegraph__query_memory {query}
  - stats: mcp__codegraph__memory_stats
  - export: mcp__codegraph__export_memory_markdown {platform?}
  - sync: mcp__codegraph__sync_memory_platform {platform, sourcePath}
  - platforms: mcp__codegraph__supported_platforms

  Execute the appropriate MCP tool and return the result.`,
  { label: 'memory-execute', phase: 'Execute', agent: 'coder-workflow:memory-librarian' }
)

return { result }
```

CLI invocation: `coder-workflow memory-store`, `memory-query`, `memory-stats`, `memory-export`, `memory-sync`, `memory-platforms`
