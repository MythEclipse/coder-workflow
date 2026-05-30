---
description: Run a read-only architecture audit of the current project. Check for fat controllers, missing repositories, schema-less boundaries, layer leakage, cross-module leaks, and circular dependencies.
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Run the `auditor` skill to perform a comprehensive read-only architecture audit.

## Process

1. **Scope**: Use the provided argument or scan the project to identify the audit boundary.
2. **Map architecture**: Identify routes, controllers, services, repositories, schemas, shared infrastructure, and tests.
3. **Detect violations**: Check every layer for the violations listed below.
4. **Report findings**: Severity, file:line, evidence, impact, recommended fix.

## Violations to check

| Smell | Signature | Severity |
|-------|-----------|----------|
| Fat controller | Controller contains ORM queries, SQL, business decisions | High |
| Missing repository | Service calls ORM/model/database directly | High |
| Schema-less boundary | Validation inline in handler, no schema file | Medium |
| Layer leakage | Repository imports request/response types | Medium |
| Cross-module leak | Module A imports Module B's repository/controller | High |
| Flat layout | Global folders obscuring feature ownership | Medium |
| Circular dependency | A → B → A import chain | High |

## Output

1. Scope audited — paths and assumptions
2. Architecture map — current layer layout
3. Findings — severity, file:line, evidence, impact, recommendation
4. Refactor sequence — ordered safe steps
5. Verification plan — commands to run
6. Open questions — only genuine blockers
