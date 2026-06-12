---
description: Quality Guardian — detect code smell, best-practice violations, style inconsistencies, logic duplication, and architectural anomalies
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(quality-gate): Quality gate — smell detection, consistency, anomaly scan

∴ Workflow({
  name: 'quality-gate',
  description: 'Enforce quality standards: smell, duplication, style, logic anomalies, gate evaluation',
  phases: [
    { title: 'Scan',      detail: 'parallel quality scans via CodeGraph + graph tools' },
    { title: 'Evaluate',  detail: 'quality-guardian scores and ranks violations' },
    { title: 'Report',    detail: 'severity-ranked findings + remediation priorities' },
  ],
})

phase('Scan')
const [qualityMetrics, cycles, deadCode, smells] = await parallel([
  () => agent(
    `Run mcp__codegraph__analyze_quality on scope: ${$ARGUMENTS || 'full project'}.
    Run mcp__codegraph__quality_gate to get gate pass/fail status.
    Return raw metrics: complexity, coupling, cohesion, duplication.`,
    { label: 'quality-metrics', phase: 'Scan', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__find_cycles on scope: ${$ARGUMENTS || 'full project'}.
    Return all circular dependency chains with file paths.`,
    { label: 'cycles', phase: 'Scan', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__find_dead_code on scope: ${$ARGUMENTS || 'full project'}.
    Return all unreachable exports, unused functions, orphaned modules.`,
    { label: 'dead-code', phase: 'Scan', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Scan for code smells: god objects, long parameter lists, primitive obsession,
    shotgun surgery patterns, feature envy, duplicated logic blocks.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'smell-scan', phase: 'Scan', skill: 'quality-guardian' }
  ),
])

phase('Evaluate')
const evaluation = await agent(
  `Evaluate all quality findings and produce severity-ranked report.
  Apply quality gate: PASS if no CRITICAL/HIGH issues, WARN if MEDIUM, FAIL if CRITICAL.
  Metrics: ${qualityMetrics}
  Cycles: ${cycles}
  Dead code: ${deadCode}
  Smells: ${smells}`,
  { label: 'evaluate', phase: 'Evaluate', skill: 'quality-guardian' }
)

phase('Report')
const report = await agent(
  `Produce final quality report:
  1. Gate status: PASS / WARN / FAIL
  2. Top violations ranked by severity
  3. Quick wins (easy fixes first)
  4. Estimated effort to reach PASS
  Evaluation: ${evaluation}`,
  { label: 'quality-report', phase: 'Report' }
)

return { report, gateStatus: evaluation.gateStatus }
```

CLI invocation: `coder-workflow quality [scope]`.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `Read` tool instead.
> - `mcp__codegraph__update_codebase` and `mcp__codegraph__diff_graphs` are available for partial graph updates and structural comparison.
> - Use `mcp__codegraph__analyze_quality` for graph-backed quality analysis, `mcp__codegraph__quality_gate` for gate evaluation, and `mcp__codegraph__find_dead_code`/`mcp__codegraph__find_cycles` for targeted scans.
