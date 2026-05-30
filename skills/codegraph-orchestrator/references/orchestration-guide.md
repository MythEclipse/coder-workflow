# CodeGraph Orchestrator — Reference Guide

## Skill Routing Matrix

| User Request Pattern | Target Skill | Why |
|---------------------|--------------|-----|
| "Scan the codebase" | `scan-codegraph` | Build/refresh graph |
| "What does this repo do?" | `scan-codegraph` → `analyze-codegraph` | Structure + architecture |
| "Where is X implemented?" | `query-codegraph` | Definition/reference lookup |
| "Who calls Y?" | `query-codegraph` | Caller analysis |
| "Find all references to Z" | `query-codegraph` | Reference search |
| "Search for 'TODO_AUTH'" | `query-codegraph` + text search | Literal/regex search |
| "Read these 10 files" | `batch-codegraph` | Parallel independent reads |
| "What's the architecture?" | `analyze-codegraph` | Architecture summary |
| "What breaks if I change X?" | `analyze-codegraph` (impact) | Blast radius |
| "Are there circular deps?" | `analyze-codegraph` (cycles) | Cycle detection |
| "What files are unused?" | `analyze-codegraph` (orphans) | Dead code identification |
| "Refactor to MVC" | `modular-mvc-refactor` → `refraktor` | Structural transformation |
| "Export a diagram" | `export-codegraph` | Static export |
| "Open the graph viewer" | `open-codegraph-ui` | Interactive UI |

## Decision Tree

```
User request
├── Graph missing/stale? → scan-codegraph first
├── Single known file? → Read directly (skip graph)
├── Exact text search? → query-codegraph + search_code
├── Relationship question? → query-codegraph
├── Architecture/impact/risk? → analyze-codegraph
├── Multiple independent ops? → batch-codegraph
├── Structural refactor? → modular-mvc-refactor
├── Static export? → export-codegraph
└── Interactive view? → open-codegraph-ui
```

## Fallback Order

1. **Graph tools** — `query_graph`, `search_code`, `analyze_impact`, etc.
2. **CLI tools** — `codegraph-mapper query`, `codegraph-mapper search`, etc.
3. **Fallback** — grep/find/Explore agents (only after graph/search cannot answer)

## Graph Before Grep

This is the cardinal rule. ALWAYS try graph tools first:

| Instead of | Use |
|-----------|-----|
| `grep -r "UserRepository" .` | `query_graph("UserRepository")` |
| `find . -name "*.route.ts"` | `query_graph("routes")` |
| `grep -r "import.*auth" .` | `query_graph("what imports auth")` |
| Explore agent for architecture | `analyze-codegraph` |

## Benchmark Flow

When first exploring a codebase:

1. `scan-codegraph` — build graph
2. `summarize_architecture` — get overview
3. `summarize_graph` — understand scale
4. `analyze_quality` — check for issues
5. Route subsequent work based on findings
