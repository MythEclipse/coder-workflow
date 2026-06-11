---
description: TDD test generation — coverage gap detection, unit/integration/e2e test scaffolding
argument-hint: [scope-or-feature]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(tdd-test-scaffold): TDD test scaffolding with coverage gap detection

∴ Workflow({
  name: 'tdd-test-scaffold',
  description: 'Detect coverage gaps, generate unit/integration/e2e tests, verify coverage improves',
  phases: [
    { title: 'Discover',  detail: 'CodeGraph + coverage scan — map untested paths' },
    { title: 'Scaffold',  detail: '1 test-engineer per module — all parallel' },
    { title: 'Verify',    detail: 'run tests, measure coverage delta' },
  ],
})

phase('Discover')
const [coverageMap, codeGraph] = await parallel([
  () => agent(
    `Aggregate existing test coverage for scope: ${$ARGUMENTS || 'full project'}.
    Use mcp__codegraph__aggregate_coverage if available, else parse coverage JSON.
    Identify: uncovered functions, untested branches, missing integration seams.`,
    { label: 'coverage-scan', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Map all public functions and exported APIs in scope: ${$ARGUMENTS || 'full project'}.
    Use mcp__codegraph__query_graph. Return list of testable units with complexity scores.`,
    { label: 'testable-units', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Scaffold')
const testResults = await parallel([
  agent(
    `Write unit tests for all uncovered functions identified in coverage scan.
    Follow TDD: test behavior, not implementation. No mocks unless strictly necessary.
    Coverage gaps: ${coverageMap}
    Testable units: ${codeGraph}`,
    { label: 'unit-tests', phase: 'Scaffold', agent: 'coder-workflow:test-engineer' }
  ),
  agent(
    `Write integration tests for all service boundaries and inter-module contracts
    identified in the code graph. Focus on input/output contracts.
    Code graph: ${codeGraph}`,
    { label: 'integration-tests', phase: 'Scaffold', agent: 'coder-workflow:test-engineer' }
  ),
])

phase('Verify')
const coverageVerify = await agent(
  `Run the full test suite and measure coverage delta.
  Report: tests added, coverage before vs after, remaining gaps.
  Test files created: ${testResults.map(r => r.label).join(', ')}`,
  { label: 'coverage-verify', phase: 'Verify', agent: 'coder-workflow:test-engineer' }
)

return { coverageVerify, testsAdded: testResults.length }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
