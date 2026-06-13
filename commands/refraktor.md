---
description: Refactor codebase to Modular MVC + Service + Repository architecture
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
Run concurrently:
  - Map current layer architecture. Identify: controllers, services, repositories, models. Detect fat controllers, mixed concerns, missing layers, cross-layer coupling. Scope: [results from previous phase]. Use your graph/mapping tools.,
  - Run your graph/mapping tools and graph/mapping tools for scope: [results from previous phase]. Return all cycle chains and orphaned exports.,
  - Run your graph/mapping tools on the root entry points of scope: [results from previous phase]. Return impact radius — which files will be touched by the refactor.,

### Phase: Plan
- Produce a complete migration plan to Modular MVC + Service + Repository architecture. Each task in the plan must: - Declare FILE_MANIFEST (source files → target paths) - Target one module/layer at a time - Include verification criteria Layer map: [results from previous phase] Violations: [results from previous phase] Impact radius: [results from previous phase] Scope: [results from previous phase]

### Phase: Swarm
Run concurrently:
  - Spawn an agent for each task defined in the migration plan.

### Phase: Verify
- Post-refactor verification: Run your graph/mapping tools then re-scan. Confirm: no remaining layer violations, no new circular deps, all imports resolve. Refactored modules: [results from previous phase]

### Phase: Synthesize
- Synthesize refactor results: file diff summary, layer compliance score before/after, remaining issues if any. Resolve any merge conflicts between parallel agents. Results: [results from previous phase] Audit: [results from previous phase]

```

