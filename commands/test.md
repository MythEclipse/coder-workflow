---
description: TDD test generation — coverage gap detection, unit/integration/e2e test scaffolding
argument-hint: [scope-or-feature]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
Run concurrently:
  - Aggregate existing test coverage for scope: [results from previous phase]. Use your graph/mapping tools if available, else parse coverage JSON. Identify: uncovered functions, untested branches, missing integration seams.,
  - Map all public functions and exported APIs in scope: [results from previous phase]. Use your graph/mapping tools. Return list of testable units with complexity scores.,

### Phase: Scaffold
Run concurrently:
  agent(
    `Write unit tests for all uncovered functions identified in coverage scan.
    Follow TDD: test behavior, not implementation. No mocks unless strictly necessary.
    Coverage gaps: ${coverageMap}
    Testable units: ${codeGraph}`,
    { label: 'unit-tests', phase: 'Scaffold', agent: 'coder-workflow:test-engineer' }
  agent(
    `Write integration tests for all service boundaries and inter-module contracts
    identified in the code graph. Focus on input/output contracts.
    Code graph: ${codeGraph}`,
    { label: 'integration-tests', phase: 'Scaffold', agent: 'coder-workflow:test-engineer' }

### Phase: Verify
- Run the full test suite and measure coverage delta. Report: tests added, coverage before vs after, remaining gaps. Test files created: [results from previous phase]

```

