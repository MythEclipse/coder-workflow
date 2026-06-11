---
description: Run a read-only architecture audit of the current project. Checks for fat controllers, missing repositories, schema-less boundaries, layer leakage, cross-module leaks, and circular dependencies.
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(architecture-audit): Comprehensive read-only architecture audit

∴ Workflow({
  name: 'architecture-audit',
  description: 'Read-only audit: layer violations, circular deps, fat controllers, orphaned code',
  phases: [
    { title: 'Discover',  detail: 'CodeGraph scan — map module boundaries and call graph' },
    { title: 'Analyze',   detail: 'architecture-auditor runs full violation scan' },
    { title: 'Synthesize', detail: 'compile severity-ranked audit report' },
  ],
})

phase('Discover')
const [graphScan, deadCode] = await parallel([
  () => agent(
    `Scan codebase structure via CodeGraph. Map all module boundaries, identify entry points, trace major data flows. Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'graph-scan', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__find_dead_code and mcp__codegraph__find_cycles. Return raw findings.`,
    { label: 'dead-cycles', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Analyze')
const auditReport = await agent(
  `Perform comprehensive architecture audit on scope: ${$ARGUMENTS || 'full project'}.
  Check: fat controllers, missing repositories, schema-less boundaries, layer leakage,
  cross-module coupling, circular dependencies, missing abstractions.
  Graph findings: ${graphScan}
  Dead code / cycles: ${deadCode}
  Output: severity-ranked violations with file:line references.`,
  { label: 'architecture-audit', phase: 'Analyze', agent: 'coder-workflow:architecture-auditor' }
)

phase('Synthesize')
const report = await agent(
  `Compile final audit report from findings. Group by severity (CRITICAL/HIGH/MEDIUM/LOW).
  Add recommended remediation steps per violation type.
  Input: ${auditReport}`,
  { label: 'synthesize-audit', phase: 'Synthesize' }
)

return { report, scope: $ARGUMENTS || 'full project' }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via `coder-workflow:explore-codebase` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
