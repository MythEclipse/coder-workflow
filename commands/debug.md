---
description: Systematic bug investigation — root-cause analysis, reproduction, and targeted patch
argument-hint: [error-or-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(debug-root-cause): Systematic root-cause analysis and targeted patch

∴ Workflow({
  name: 'debug-root-cause',
  description: 'Trace, reproduce, root-cause, and patch the reported bug/error',
  phases: [
    { title: 'Triage',   detail: 'parse error/symptom + locate affected code via CodeGraph' },
    { title: 'Trace',    detail: 'debugging-engineer traces call path to root cause' },
    { title: 'Patch',    detail: 'code-implementer applies targeted fix' },
    { title: 'Verify',   detail: 'test-engineer confirms fix + regression check' },
  ],
})

phase('Triage')
const [callGraph, errorContext] = await parallel([
  () => agent(
    `Locate all code paths related to this error/symptom: $ARGUMENTS
    Use mcp__codegraph__query_graph and mcp__codegraph__analyze_impact.
    Return: affected files, call chains, entry points, suspicious modules.`,
    { label: 'locate-bug', phase: 'Triage', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Parse the error description/stack trace and identify: error type, first failing frame,
    likely root cause category (null-deref, type mismatch, async race, logic error, etc.).
    Input: $ARGUMENTS`,
    { label: 'parse-error', phase: 'Triage', agent: 'coder-workflow:debugging-engineer' }
  ),
])

phase('Trace')
const rootCause = await agent(
  `Perform systematic root-cause analysis. Follow the call graph to the deepest causal node.
  Do NOT stop at symptoms. Trace until you find the invariant violation.
  Error context: ${errorContext}
  Call graph: ${callGraph}
  Produce: root cause statement + reproduction steps + fix strategy.`,
  { label: 'root-cause', phase: 'Trace', agent: 'coder-workflow:debugging-engineer' }
)

phase('Patch')
const patch = await agent(
  `Apply the targeted fix for the root cause. Do NOT patch symptoms.
  Modify only the files identified in root cause analysis.
  Root cause: ${rootCause}`,
  { label: 'apply-patch', phase: 'Patch', agent: 'coder-workflow:code-implementer' }
)

phase('Verify')
const verification = await agent(
  `Write a targeted regression test for the fixed bug and confirm the fix holds.
  Run existing tests to confirm no regressions.
  Root cause: ${rootCause}
  Patch applied: ${patch}`,
  { label: 'verify-fix', phase: 'Verify', agent: 'coder-workflow:test-engineer' }
)

return { rootCause, patch, verification }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via `coder-workflow:explore-codebase` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
