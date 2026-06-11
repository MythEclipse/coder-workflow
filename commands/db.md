---
description: Database — SQL, indexing, schema design, migrations, Prisma/TypeORM
argument-hint: [schema-or-task]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(db-schema-design): Database schema design + migration

∴ Workflow({
  name: 'db-schema-design',
  description: 'Schema design, indexing, migration, ORM integration for: $ARGUMENTS',
  phases: [
    { title: 'Discover',  detail: 'parse current schema + query patterns + ORM models' },
    { title: 'Design',    detail: 'db-architect produces schema changes + migration plan' },
    { title: 'Implement', detail: 'parallel: migration file + ORM models + index strategy' },
    { title: 'Verify',    detail: 'dry-run migration, check index coverage, no data loss paths' },
  ],
})

phase('Discover')
const [schemaState, queryPatterns] = await parallel([
  () => agent(
    `Parse current database schema: run mcp__codegraph__parse_prisma_schema or read migration files.
    Return: current tables, columns, relationships, existing indexes.`,
    { label: 'schema-scan', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Find all database query patterns in codebase: raw SQL, ORM queries, N+1 risks.
    Identify slow query candidates and missing index opportunities.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'query-patterns', phase: 'Discover', agent: 'coder-workflow:db-architect' }
  ),
])

phase('Design')
const designPlan = await agent(
  `Produce complete schema change plan for: $ARGUMENTS
  Include: entity-relationship diagram (text), column types, constraints, foreign keys.
  Index strategy: cover all query patterns identified.
  Migration safety: additive first, no destructive changes without explicit confirmation.
  Current schema: ${schemaState}
  Query patterns: ${queryPatterns}`,
  { label: 'schema-design', phase: 'Design', agent: 'coder-workflow:db-architect' }
)

phase('Implement')
const [migrationResult, ormResult, indexResult] = await parallel([
  () => agent(
    `Generate migration file (Prisma/TypeORM/raw SQL) from design plan.
    Design: ${designPlan}`,
    { label: 'migration', phase: 'Implement', agent: 'coder-workflow:db-architect' }
  ),
  () => agent(
    `Update ORM models/entities to match new schema.
    Design: ${designPlan}`,
    { label: 'orm-models', phase: 'Implement', agent: 'coder-workflow:db-architect' }
  ),
  () => agent(
    `Add all recommended indexes from the design plan.
    Index strategy: ${designPlan}`,
    { label: 'indexes', phase: 'Implement', agent: 'coder-workflow:db-architect' }
  ),
])

phase('Verify')
const verify = await agent(
  `Validate migration safety:
  - No accidental DROP or TRUNCATE without guard
  - All foreign key constraints are valid
  - Index coverage confirmed for identified query patterns
  - ORM models match migration schema
  Migration: ${migrationResult}
  ORM: ${ormResult}
  Indexes: ${indexResult}`,
  { label: 'db-verify', phase: 'Verify', agent: 'coder-workflow:db-architect' }
)

return { verify, designPlan }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
