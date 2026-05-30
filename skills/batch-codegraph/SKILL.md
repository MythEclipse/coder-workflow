---
name: batch-codegraph
description: Execute multiple read, search, or query operations in parallel. Use when user asks for many reads, searches, or mixed lookups at once. Batch tools handle up to 50 items with bounded concurrency and per-item success/failure tracking. Skip for single operations or when graph is missing.
version: 0.2.0
---

# Batch CodeGraph Operations

Parallelize independent read, search, and query operations with bounded concurrency and per-item tracking.

## CORE RULE

Batch only independent operations; do not batch dependent reads/searches. If operation B needs result from operation A, run A first, then B. Batch is for "read these 5 files" or "search for these 3 patterns"—not for "read A, then based on A's result read B."

## Trigger

**Use this skill when:**
- User asks for many reads, searches, or mixed lookups at once
- Graph data exists and is current
- Need to parallelize independent operations
- Operations have no dependencies on each other

**Examples:**
- "read these 5 files"
- "search for TODO, FIXME, BUG in parallel"
- "query graph for app, handler, middleware, router"
- "find all references to these 3 functions"

## Do not use

- Do not batch dependent operations (A's result feeds into B)
- Do not use if graph is missing or stale (use `scan-codegraph` first)
- Do not batch single operations (use individual tools instead)
- Do not batch if you need to inspect results mid-batch to decide next steps

## Workflow

1. Verify `.codegraph/graph.db` exists. If missing, use `scan-codegraph` first.

2. Identify operation type: read files, search code, query graph, or mixed.

3. Collect items (up to 50) into batch request. Verify all operations are independent.

4. Choose concurrency (default 4, max 16) based on system load.

5. Use appropriate batch tool:
   - `batch_read_files` — multiple file reads with optional line ranges
   - `batch_search_code` — multiple text/regex searches
   - `batch_query_graph` — multiple graph queries
   - `batch_tasks` — mixed read/search/query operations

6. Parse partial-success envelope: check `succeeded`/`failed` counts, inspect per-item `ok` status and errors.

7. Report results grouped by success/failure, cite paths and symbols precisely.

## API contract

All batch operations return:
```json
{
  "concurrency": 4,
  "total": 10,
  "succeeded": 9,
  "failed": 1,
  "results": [
    { "ok": true, "index": 0, "input": {...}, "result": {...} },
    { "ok": false, "index": 1, "input": {...}, "error": "message" }
  ]
}
```

**CLI usage:**
```bash
codegraph-mapper batch-read '[{"filePath":"src/a.ts"},{"filePath":"src/b.ts"}]'
codegraph-mapper batch-search '[{"pattern":"TODO"},{"pattern":"FIXME"}]'
codegraph-mapper batch-query '[{"query":"app"},{"query":"handler"}]' --concurrency 8
```

**MCP usage:**
```python
result = client.call_tool("batch_read_files", {
  "items": [
    {"filePath": "src/a.ts", "startLine": 1, "endLine": 10},
    {"filePath": "src/b.ts"}
  ],
  "concurrency": 4
})

result = client.call_tool("batch_search_code", {
  "items": [
    {"pattern": "TODO", "caseSensitive": False},
    {"pattern": "FIXME", "caseSensitive": False}
  ]
})

result = client.call_tool("batch_query_graph", {
  "items": [
    {"query": "app"},
    {"query": "handler"},
    {"query": "middleware"}
  ]
})

result = client.call_tool("batch_tasks", {
  "tasks": [
    {"type": "read_file", "input": {"filePath": "src/app.ts"}},
    {"type": "search_code", "input": {"pattern": "export"}},
    {"type": "query_graph", "input": {"query": "app"}}
  ]
})
```

## Red flags

- Graph missing or stale: use `scan-codegraph` first
- Operation B depends on result from operation A: run A first, then B
- Single operation: use individual tool instead
- Need to inspect mid-batch: run in stages instead
- Partial failures: check per-item `ok` status and errors before proceeding

## Output contract

- Concurrency level used
- Total items, succeeded count, failed count
- Per-item results with index, input, and result or error
- Group results by success/failure for clarity
- Cite file paths and symbols precisely

