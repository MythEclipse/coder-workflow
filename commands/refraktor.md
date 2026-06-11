---
description: Refactor codebase to Modular MVC + Service + Repository architecture
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(refactor-modular-mvc): Structural refactor to Modular MVC + Service + Repository

∴ Workflow({
  name: 'refactor-modular-mvc',
  description: 'Refactor codebase to Modular MVC + Service + Repository layer pattern',
  phases: [
    { title: 'Discover',  detail: 'CodeGraph scan — map current layer structure + violations' },
    { title: 'Plan',      detail: 'refactoring-engineer produces migration plan with FILE_MANIFEST per module' },
    { title: 'Swarm',     detail: '1 implementer per module — all parallel, no worktrees' },
    { title: 'Verify',    detail: 'architecture-auditor confirms no layer violations post-refactor' },
    { title: 'Synthesize', detail: 'merge results, resolve conflicts, produce diff summary' },
  ],
})

phase('Discover')
const [layerMap, violations, impactRadius] = await parallel([
  () => agent(
    `Map current layer architecture. Identify: controllers, services, repositories, models.
    Detect fat controllers, mixed concerns, missing layers, cross-layer coupling.
    Scope: ${$ARGUMENTS || 'full project'}. Use mcp__codegraph__analyze_quality.`,
    { label: 'layer-map', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__find_cycles and mcp__codegraph__find_dead_code for scope: ${$ARGUMENTS || 'full project'}.
    Return all cycle chains and orphaned exports.`,
    { label: 'violations-scan', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__analyze_impact on the root entry points of scope: ${$ARGUMENTS || 'full project'}.
    Return impact radius — which files will be touched by the refactor.`,
    { label: 'impact-radius', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Plan')
const migrationPlan = await agent(
  `Produce a complete migration plan to Modular MVC + Service + Repository architecture.
  Each task in the plan must:
  - Declare FILE_MANIFEST (source files → target paths)
  - Target one module/layer at a time
  - Include verification criteria
  Layer map: ${layerMap}
  Violations: ${violations}
  Impact radius: ${impactRadius}
  Scope: ${$ARGUMENTS || 'full project'}`,
  { label: 'migration-plan', phase: 'Plan', agent: 'coder-workflow:refactoring-engineer' }
)

phase('Swarm')
const refactorResults = await parallel(
  migrationPlan.tasks.map(task => () => agent(
    task.prompt,
    { label: task.label, phase: 'Swarm', agent: 'coder-workflow:code-implementer' }
  ))
)

phase('Verify')
const postAudit = await agent(
  `Post-refactor verification: run mcp__codegraph__update_codebase then re-scan.
  Confirm: no remaining layer violations, no new circular deps, all imports resolve.
  Refactored modules: ${refactorResults.map(r => r.label).join(', ')}`,
  { label: 'post-audit', phase: 'Verify', agent: 'coder-workflow:architecture-auditor' }
)

phase('Synthesize')
const report = await agent(
  `Synthesize refactor results: file diff summary, layer compliance score before/after,
  remaining issues if any. Resolve any merge conflicts between parallel agents.
  Results: ${JSON.stringify(refactorResults)}
  Audit: ${postAudit}`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { report, modulesRefactored: migrationPlan.tasks.length, postAudit }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via `coder-workflow:explore-codebase` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
