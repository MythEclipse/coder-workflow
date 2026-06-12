---
description: Generate architecture diagram from CodeGraph — module dependency visualization
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(arch-diagram): Generate architecture diagram from CodeGraph

∴ Workflow({
  name: 'arch-diagram',
  description: 'Visualize module architecture: dependency graph, call flows, layer structure',
  phases: [
    { title: 'Export',   detail: 'parallel: graph export + architecture summary' },
    { title: 'Render',   detail: 'diagram-engineer generates Mermaid + PlantUML + text' },
  ],
})

phase('Export')
const [graphExport, archSummary] = await parallel([
  () => agent(
    `Run mcp__codegraph__export_graph on scope: ${$ARGUMENTS || 'full project'}.
    Return: nodes (modules/functions) + edges (imports/calls) in structured format.`,
    { label: 'graph-export', phase: 'Export', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__summarize_architecture: high-level module breakdown,
    layer boundaries, key data flows.`,
    { label: 'arch-summary', phase: 'Export', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Render')
const diagram = await agent(
  `Generate architecture diagrams from the exported graph:
  1. Mermaid flowchart: module dependencies
  2. Layer diagram: Controller → Service → Repository → Database
  3. Text summary: key architectural decisions visible in the graph
  Graph: ${graphExport}
  Summary: ${archSummary}`,
  { label: 'render-diagram', phase: 'Render', skill: 'diagram-engineer' }
)

return { diagram }
```
