---
description: Detect unused exports, dead code, and unreachable modules
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(deadcode-scan): Detect unused exports + dead code

∴ Workflow({
  name: 'deadcode-scan',
  description: 'Find unreachable code, unused exports, orphaned modules',
  phases: [
    { title: 'Scan',   detail: 'parallel: CodeGraph dead code + tree-shake analysis' },
    { title: 'Report', detail: 'ranked list with deletion safety assessment' },
  ],
})

phase('Scan')
const [deadCode, orphans, unusedExports] = await parallel([
  () => agent(
    `Run mcp__codegraph__find_dead_code on scope: ${$ARGUMENTS || 'full project'}.
    Return: unreachable functions, dead branches, never-called exports.`,
    { label: 'dead-code', phase: 'Scan', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__find_orphans: modules with no incoming edges in the call graph.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'orphans', phase: 'Scan', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Find all exported symbols with zero import references in the codebase.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'unused-exports', phase: 'Scan', agent: 'coder-workflow:architecture-auditor' }
  ),
])

phase('Report')
const report = await agent(
  `Compile dead code report:
  1. Safe to delete (confirmed dead, no dynamic references)
  2. Likely dead (no static refs but may have dynamic usage)
  3. Orphaned modules (no callers but may be entry points)
  Include: estimated LOC reduction, deletion commands.
  Dead: ${deadCode}, Orphans: ${orphans}, Unused: ${unusedExports}`,
  { label: 'deadcode-report', phase: 'Report' }
)

return { report }
```
