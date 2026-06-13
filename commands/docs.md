---
description: Documentation generation — README, API specs, inline docs, architecture guides
argument-hint: [scope-or-doc-type]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
Run concurrently:
  - Map all public APIs, exported functions, and interfaces in scope: [results from previous phase]. Use your graph/mapping tools. Include: function signatures, return types, param descriptions.,
  - Generate architecture summary via graph/mapping tools. Return: module boundaries, data flow, key decisions, tech stack.,

### Phase: Generate
Run concurrently:
  - Generate or update README.md: project overview, setup, usage, architecture diagram reference. Architecture: [results from previous phase] Scope: [results from previous phase],
  - Generate API documentation (OpenAPI/markdown) from mapped interfaces. API map: [results from previous phase],
  - Add/update inline JSDoc/TSDoc comments for all undocumented exported functions. API map: [results from previous phase],

### Phase: Verify
- Verify documentation completeness: - All exported APIs have JSDoc - README is up to date with actual project structure - No stale or broken cross-references Generated: [results from previous phase]

```

