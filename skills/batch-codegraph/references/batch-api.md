# Batch CodeGraph — Reference Guide

## MCP Tools

| Tool | Description |
|------|-------------|
| `batch_read_files` | Read multiple files with optional line ranges |
| `batch_search_code` | Multiple text/regex searches in parallel |
| `batch_query_graph` | Multiple graph queries in parallel |
| `batch_tasks` | Mixed read/search/query operations |

## CLI Usage

```bash
codegraph-mapper batch-read '[{"filePath":"src/a.ts"},{"filePath":"src/b.ts"}]'
codegraph-mapper batch-search '[{"pattern":"TODO"},{"pattern":"FIXME"}]'
codegraph-mapper batch-query '[{"query":"app"},{"query":"handler"}]' --concurrency 8
```

## MCP Usage

```python
# Batch file reads
result = client.call_tool("batch_read_files", {
  "items": [
    {"filePath": "src/a.ts", "startLine": 1, "endLine": 10},
    {"filePath": "src/b.ts"}
  ],
  "concurrency": 4
})

# Batch searches
result = client.call_tool("batch_search_code", {
  "items": [
    {"pattern": "TODO", "caseSensitive": False},
    {"pattern": "FIXME", "caseSensitive": False}
  ]
})

# Batch graph queries
result = client.call_tool("batch_query_graph", {
  "items": [
    {"query": "app"},
    {"query": "handler"},
    {"query": "middleware"}
  ]
})

# Mixed operations
result = client.call_tool("batch_tasks", {
  "tasks": [
    {"type": "read_file", "input": {"filePath": "src/app.ts"}},
    {"type": "search_code", "input": {"pattern": "export"}},
    {"type": "query_graph", "input": {"query": "app"}}
  ]
})
```

## API Contract

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

## Concurrency Guidelines

| Workload | Concurrency | Rationale |
|----------|-------------|-----------|
| Small (< 5 items) | 4 | Default, sufficient |
| Medium (5-20 items) | 4-8 | Balance speed and resource usage |
| Large (20-50 items) | 8-16 | Max throughput |
| System under load | 2-4 | Reduce contention |

## When NOT to Batch

- Operation B depends on result from operation A
- Single operation (use individual tool)
- Need to inspect mid-batch results to decide next steps
- Graph missing or stale (scan first)

## Partial Failure Handling

- Check `succeeded`/`failed` counts before processing results
- Inspect per-item `ok` status
- Failed items include `error` message — decide whether to retry or skip
- Do not assume all-or-nothing: partial success is the normal case for large batches
