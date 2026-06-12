# CodeGraph Tool Guides

Standardized references for CodeGraph MCP tool usage across agents.

## Core Query Tools

### `query_graph`
Search for definitions, references, types, callers, callees, imports, exports, dependencies.
- Use to verify functions/types exist before writing code
- Useful queries: `"function createUser"`, `"interface UserRepository"`, `"import { Router } from 'express'"`

### `search_code`
Regex/literal source text search with multi-pattern batch.
- Use `patterns: ["error", "try {", "catch"]` for batch discovery
- Use `maxResults: 20` for overview, then narrow
- `contextLines: 3` for surrounding context

### `analyze_impact`
Upstream/downstream impact analysis. Use BEFORE refactoring to check dependents.
- direction: `"upstream"` (who calls this), `"downstream"` (who this calls), `"both"`

## Analysis Tools

### `find_cycles`
Detect circular dependencies. Causal analysis mandatory for each cycle found.

### `find_orphans`
After deleting a function or file, check if anything still references it.

### `summarize_architecture`
Entry points, modules, dependencies, hotspots. Useful for structural recon.

## Validation Tools

### `check_graph_freshness`
Check if graph DB is fresh before analysis. If stale, run `scan_codebase`.

### `validate_json_file`
Validate JSON files (OpenAPI specs, configs) against schemas.

## Coverage & Quality

### `aggregate_coverage`
Merge coverage reports from jest, vitest, istanbul into unified report.

### `analyze_complexity`
Measure cyclomatic complexity across the codebase.

### `check_coverage_threshold`
Validate coverage meets minimum threshold.
