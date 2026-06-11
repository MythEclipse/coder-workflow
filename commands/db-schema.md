---
description: Prisma/TypeORM schema diff — detect breaking changes between schema versions
argument-hint: [base-ref-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(db-schema-diff): Parse and diff database schema versions

∴ Workflow({
  name: 'db-schema-diff',
  description: 'Parse schema, diff versions, detect breaking changes',
  phases: [
    { title: 'Parse',  detail: 'parallel: current schema + base schema' },
    { title: 'Diff',   detail: 'compute structural diff — additions, deletions, renames' },
    { title: 'Report', detail: 'breaking change assessment + migration safety check' },
  ],
})

phase('Parse')
const [currentSchema, baseSchema] = await parallel([
  () => agent(
    `Run mcp__codegraph__parse_prisma_schema on current HEAD schema files.
    Return: tables, columns, types, relationships, indexes.`,
    { label: 'current-schema', phase: 'Parse', agent: 'coder-workflow:db-architect' }
  ),
  () => agent(
    `Get base schema from: ${$ARGUMENTS || 'main branch or last migration checkpoint'}.
    Parse the same schema format for comparison.`,
    { label: 'base-schema', phase: 'Parse', agent: 'coder-workflow:db-architect' }
  ),
])

phase('Diff')
const schemaDiff = await agent(
  `Compute schema diff:
  - Added tables/columns (additive, safe)
  - Removed tables/columns (destructive, BREAKING)
  - Type changes (potentially breaking)
  - Renamed columns (breaking without migration rename)
  - Index changes (performance impact)
  Current: ${currentSchema}
  Base: ${baseSchema}`,
  { label: 'schema-diff', phase: 'Diff', agent: 'coder-workflow:db-architect' }
)

phase('Report')
const report = await agent(
  `Schema diff report:
  1. BREAKING CHANGES (require migration + data transform)
  2. ADDITIVE CHANGES (safe, no data risk)
  3. Required migration steps in order
  4. Rollback plan if migration fails
  Diff: ${schemaDiff}`,
  { label: 'schema-report', phase: 'Report' }
)

return { report, schemaDiff }
```
