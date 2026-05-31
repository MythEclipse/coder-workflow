---
description: Run a read-only architecture audit of the current project. Checks for fat controllers, missing repositories, schema-less boundaries, layer leakage, cross-module leaks, and circular dependencies.
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Invoke the `architecture-auditor` agent to perform a comprehensive read-only architecture audit.

The `architecture-auditor` agent is the single source of truth for violation definitions, severity levels, audit process, and output format. Do not duplicate those rules here — invoke the agent with the given scope and let it run its full process.

If a scope argument is provided, pass it to the agent as the audit boundary. If no argument, the agent will scan the full project.
