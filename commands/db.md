---
description: Database — SQL, indexing, schema design, migrations, Prisma/TypeORM
argument-hint: [schema-or-task]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
Run concurrently:
  - Parse current database schema: Run your graph/mapping tools or read migration files. Return: current tables, columns, relationships, existing indexes.,
  - Find all database query patterns in codebase: raw SQL, ORM queries, N+1 risks. Identify slow query candidates and missing index opportunities. Scope: [results from previous phase],

### Phase: Design
- Produce complete schema change plan for: $ARGUMENTS Include: entity-relationship diagram (text), column types, constraints, foreign keys. Index strategy: cover all query patterns identified. Migration safety: additive first, no destructive changes without explicit confirmation. Current schema: [results from previous phase] Query patterns: [results from previous phase]

### Phase: Implement
Run concurrently:
  - Generate migration file (Prisma/TypeORM/raw SQL) from design plan. Design: [results from previous phase],
  - Update ORM models/entities to match new schema. Design: [results from previous phase],
  - Add all recommended indexes from the design plan. Index strategy: [results from previous phase],

### Phase: Verify
- Validate migration safety: - No accidental DROP or TRUNCATE without guard - All foreign key constraints are valid - Index coverage confirmed for identified query patterns - ORM models match migration schema Migration: [results from previous phase] ORM: [results from previous phase] Indexes: [results from previous phase]

```

