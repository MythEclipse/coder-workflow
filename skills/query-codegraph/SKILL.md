---
name: query-codegraph
description: Search codebase using graph to find definitions, references, callers, callees, imports, exports, routes, handlers, components. Trigger even when the user does not mention CodeGraph or MCP. Use before grep/find/Explore agents. For exact literal text search, use CodeGraph Mapper text search.
version: 0.2.0
---

# Query CodeGraph

Answer codebase search and relationship questions using `.codegraph/graph.db`. Graph-backed exploration before raw grep/find.

## Trigger

- User asks where code lives, where features are implemented, who calls X, what imports Y, which routes exist
- Need to find definitions, references, callers, callees, dependencies
- Tracing flow or understanding relationships across files
- Broad codebase search or exploration
- Trigger even when the user does not mention CodeGraph or MCP

## Do not use

- Single known file read: "open src/foo.ts"
- Configuration read: "what's in package.json"
- Graph missing and user did not request scan (use `scan-codegraph` first)

## Workflow

1. Verify `.codegraph/graph.db` exists. If missing, use `scan-codegraph` first.

2. Use MCP tool `query_graph` if available.

3. Query by stable identifiers:
   - File path
   - Symbol name
   - Node ID
   - Import path
   - Route path
   - Component name

4. For exact literal text search, use `search_code` before grep:
   ```bash
   codegraph-mapper search "pattern"
   codegraph-mapper search "pattern" --regex --context 2
   codegraph-mapper search "pattern" --include "src/**/*.ts" --exclude "**/*.test.ts"
   ```

5. Read source files only when code snippets or exact behavior needed.

## Red flags

- Graph missing: suggest `scan-codegraph` first
- Graph stale: user reports recent changes not reflected; suggest rescan
- Query returns no results: verify node/symbol name, check ignore rules, consider rescan
- Ambiguous symbol: disambiguate by file path or context

## Output contract

Keep answers graph-backed and navigable:
- Direct answer first
- List important nodes and edges
- Include file paths and symbol names
- Note uncertainty when graph lacks precision
- Suggest rescan if graph appears stale

Example:
```
Auth route flow:
1. src/routes/auth.ts:POST /login → loginHandler
2. src/auth/service.ts:loginHandler → validateCredentials
3. src/auth/tokens.ts:validateCredentials → issueToken

Upstream: src/server.ts, src/routes/index.ts
Downstream: src/db/users.ts, src/auth/tokens.ts
```

Next: `analyze-codegraph` for impact/architecture, `export-codegraph` for Mermaid/DOT/JSON output.

