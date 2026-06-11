---
description: Proactive Bug Hunter — scan code for common bug patterns across the codebase
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(bug-hunt): Proactive bug scan — detect, classify, document

∴ Workflow({
  name: 'bug-hunt',
  description: 'Scan codebase for bug patterns: null-deref, race conditions, logic errors, type mismatches',
  phases: [
    { title: 'Scan',      detail: 'parallel multi-angle bug pattern detection' },
    { title: 'Triage',    detail: 'classify by severity, verify reproduction paths' },
    { title: 'Report',    detail: 'structured bug report + TaskCreate for each CRITICAL/HIGH' },
  ],
})

phase('Scan')
const [nullRisks, asyncRisks, typeRisks, logicRisks] = await parallel([
  () => agent(
    `Scan for null/undefined dereference risks: optional chaining missing, unchecked API responses,
    unguarded array access. Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'null-scan', phase: 'Scan', agent: 'coder-workflow:debugging-engineer' }
  ),
  () => agent(
    `Scan for async/concurrency bugs: missing await, unhandled promise rejections,
    race conditions, improper error propagation in async chains.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'async-scan', phase: 'Scan', agent: 'coder-workflow:debugging-engineer' }
  ),
  () => agent(
    `Scan for type safety violations: implicit any, unsafe casts, runtime type mismatches,
    missing type guards. Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'type-scan', phase: 'Scan', agent: 'coder-workflow:debugging-engineer' }
  ),
  () => agent(
    `Scan for logic bugs: off-by-one errors, incorrect boundary conditions, wrong operator usage,
    missing edge case handling. Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'logic-scan', phase: 'Scan', agent: 'coder-workflow:debugging-engineer' }
  ),
])

phase('Triage')
const triage = await agent(
  `Classify all discovered bugs by:
  - Severity: CRITICAL (data loss/security) / HIGH (crash) / MEDIUM (wrong behavior) / LOW (minor)
  - Type: null-deref / async / type / logic / edge-case
  - Reproducibility: confirmed / likely / suspected
  Produce reproduction steps for CRITICAL + HIGH bugs.
  Bugs found:
  Null risks: ${nullRisks}
  Async risks: ${asyncRisks}
  Type risks: ${typeRisks}
  Logic risks: ${logicRisks}`,
  { label: 'triage', phase: 'Triage', agent: 'coder-workflow:debugging-engineer' }
)

phase('Report')
const report = await agent(
  `Produce final bug report:
  1. Summary: total bugs by severity
  2. CRITICAL/HIGH detail: file:line, reproduction, impact
  3. Create TaskCreate for each CRITICAL and HIGH bug
  4. MEDIUM/LOW list for future tracking
  Triage: ${triage}`,
  { label: 'bug-report', phase: 'Report' }
)

return { report, criticalCount: triage.critical, highCount: triage.high }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it.
> - New tools: `mcp__codegraph__update_codebase`, `mcp__codegraph__diff_graphs`.
