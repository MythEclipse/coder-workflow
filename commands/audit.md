---
description: Run a read-only architecture audit of the current project. Checks for fat controllers, missing repositories, schema-less boundaries, layer leakage, cross-module leaks, and circular dependencies.
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
Run concurrently:
  - Scan codebase structure via Graph-based MCP tools. Map all module boundaries, identify entry points, trace major data flows. Scope: [results from previous phase],
  - Run your graph/mapping tools and graph/mapping tools. Return raw findings.,

### Phase: Analyze
- Perform comprehensive architecture audit on scope: [results from previous phase]. Check: fat controllers, missing repositories, schema-less boundaries, layer leakage, cross-module coupling, circular dependencies, missing abstractions. Graph findings: [results from previous phase] Dead code / cycles: [results from previous phase] Output: severity-ranked violations with file:line references.

### Phase: Synthesize
- Compile final audit report from findings. Group by severity (CRITICAL/HIGH/MEDIUM/LOW). Add recommended remediation steps per violation type. Input: [results from previous phase]

```

