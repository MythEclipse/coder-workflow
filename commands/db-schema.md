---
description: Parse Prisma/TypeORM schemas and detect schema drift
argument-hint: [prisma|compare]
allowed-tools: Read, Bash
---
Agent: `coder-workflow:db-architect`
Invoke via CLI: `coder-workflow db-schema prisma [--schema prisma/schema.prisma]` or `coder-workflow db-schema compare --before <file> --after <file>`.
Or via MCP: `parse_prisma_schema`, `diff_db_schemas`.
