# Query CodeGraph — Reference Guide

## MCP Tools

| Tool | Description |
|------|-------------|
| `query_graph` | Search for definitions, references, callers, callees, imports, exports |
| `search_code` | Literal text and regex search across project files |

## Query Patterns

### Find definitions
```
query_graph("UserRepository") → definition location, type, edges
```

### Find callers (who calls this?)
```
query_graph("who calls loginHandler") → upstream dependents
```

### Find callees (what does this call?)
```
query_graph("what does authMiddleware call") → downstream dependencies
```

### Find imports
```
query_graph("what imports @/config") → all files importing config module
```

### Find routes
```
query_graph("routes") → all route handlers and their HTTP methods
```

### Find components
```
query_graph("components") → all component definitions and usage sites
```

## Text Search Patterns

### Literal string search
```bash
codegraph-mapper search "TODO_AUTH"
codegraph-mapper search "console.error" --include "src/**/*.ts"
```

### Regex search
```bash
codegraph-mapper search "process\.env\.\w+" --regex
codegraph-mapper search "console\.(log|warn|error)" --regex --context 2
```

### Filtered search
```bash
codegraph-mapper search "import" --include "src/**/*.ts" --exclude "**/*.test.ts"
```

## Common Workflows

### Trace request flow
1. `query_graph("POST /login")` → find route handler
2. `query_graph("who calls loginHandler")` → trace upstream
3. Read handler source for business logic details

### Find all database queries
1. `search_code("prisma\." --regex)` → find ORM calls
2. Cross-reference with layer contract — are any in controllers?

### Identify module boundaries
1. `query_graph("modules")` → list module entry points
2. `analyze_impact("<module>")` → check cross-module dependencies

## When to Use Graph vs Text Search

| Need | Tool |
|------|------|
| Where is function X defined? | `query_graph` |
| Who calls function X? | `query_graph` |
| What files import module Y? | `query_graph` |
| Find literal string "magic_value_123" | `search_code` |
| Find all regex matches for pattern | `search_code --regex` |
| Understand architecture | `query_graph` + `analyze-codegraph` |

## Output Format

All query results include:
- File path and line number
- Symbol name and type
- Relationship type (import, call, component, route, etc.)
- Edge direction (inbound/outbound)
- Confidence level (high = direct edge, medium = inferred, low = text match only)
