---
description: Systematic bug investigation — root-cause analysis, reproduction, and targeted patch
argument-hint: [error-or-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Triage
Run concurrently:
  - Locate all code paths related to this error/symptom: $ARGUMENTS Use your graph/mapping tools and graph/mapping tools. Return: affected files, call chains, entry points, suspicious modules.,
  - Parse the error description/stack trace and identify: error type, first failing frame, likely root cause category (null-deref, type mismatch, async race, logic error, etc.). Input: $ARGUMENTS,

### Phase: Trace
- Perform systematic root-cause analysis. Follow the call graph to the deepest causal node. Do NOT stop at symptoms. Trace until you find the invariant violation. Error context: [results from previous phase] Call graph: [results from previous phase] Produce: root cause statement + reproduction steps + fix strategy.

### Phase: Patch
- Apply the targeted fix for the root cause. Do NOT patch symptoms. Modify only the files identified in root cause analysis. Root cause: [results from previous phase]

### Phase: Verify
- Write a targeted regression test for the fixed bug and confirm the fix holds. Run existing tests to confirm no regressions. Root cause: [results from previous phase] Patch applied: [results from previous phase]

```

