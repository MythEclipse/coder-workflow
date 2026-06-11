---
description: Compare OpenAPI specs for breaking changes between API versions
argument-hint: [base-vs-head-specs]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(api-contract-check): OpenAPI spec diff + breaking change detection

∴ Workflow({
  name: 'api-contract-check',
  description: 'Compare API specs, detect breaking changes, validate contract',
  phases: [
    { title: 'Load',   detail: 'parallel: current + base spec' },
    { title: 'Diff',   detail: 'compute breaking vs non-breaking changes' },
    { title: 'Report', detail: 'severity-ranked change list + migration guide' },
  ],
})

phase('Load')
const [currentSpec, baseSpec] = await parallel([
  () => agent(
    `Load current OpenAPI spec from: ${$ARGUMENTS?.split('..')[1] || 'HEAD (openapi.yaml/swagger.json)'}.
    Parse and normalize the spec structure.`,
    { label: 'current-spec', phase: 'Load', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Load base OpenAPI spec from: ${$ARGUMENTS?.split('..')[0] || 'main branch'}.
    Parse and normalize the spec structure.`,
    { label: 'base-spec', phase: 'Load', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Diff')
const apiDiff = await agent(
  `Run mcp__codegraph__compare_api_specs. Classify each change:
  BREAKING: removed endpoints, removed required fields, type changes, auth changes
  NON-BREAKING: new optional fields, new endpoints, deprecations
  Current: ${currentSpec}
  Base: ${baseSpec}`,
  { label: 'api-diff', phase: 'Diff', agent: 'coder-workflow:explore-codebase' }
)

phase('Report')
const report = await agent(
  `API contract report:
  1. BREAKING CHANGES: require major version bump + migration guide
  2. NON-BREAKING CHANGES: safe to ship
  3. Consumer impact assessment
  4. Recommended versioning action (patch/minor/major)
  Diff: ${apiDiff}`,
  { label: 'api-report', phase: 'Report' }
)

return { report, apiDiff }
```
