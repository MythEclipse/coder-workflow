---
name: codegraph-orchestrator
description: Route codebase work through CodeGraph skills at start of session or first repo exploration. Benchmark and coordinate scan-codegraph, query-codegraph, analyze-codegraph. Graph before grep. Graph before find. Graph before Explore agents. Use CodeGraph Mapper for structure/dependencies/callers/routes/components/architecture/impact/risk/flow/project-structure mapping. Use CodeGraph text search for exact literal text search or regex. Raw grep/find/Explore are fallbacks only after graph/search tools cannot answer.
version: 0.2.0
---

# CodeGraph Orchestrator

Route codebase work through CodeGraph Mapper skills. Graph-first before grep/find/Explore agents.

## Core rule

**Graph before grep. Graph before find. Graph before Explore agents.** Use CodeGraph Mapper for structure, dependencies, callers, routes, components, architecture, impact, risk, flow, project-structure mapping. Use CodeGraph text search (`search_code` MCP or CLI `search`) for exact literal text search or regex. Raw grep/find/Explore are fallbacks only after graph/search tools cannot answer.

## Trigger

- Start of session or first repo exploration
- User asks to understand repo, search code, analyze architecture, assess impact, trace flow, or refactor toward Modular MVC
- Benchmark codebase before broad work
- Trigger even without explicit CodeGraph mention

## Do not use

- Single known file read: "open src/foo.ts"
- Single-file typo fix with no cross-file impact

## Routing

| User asks | Use skill |
|-----------|-----------|
| Build/refresh graph or explore repo | `scan-codegraph` |
| Read 5+ files or search 5+ patterns | `batch-codegraph` |
| Where is X / who calls Y / what imports Z | `query-codegraph` |
| Exact text/regex search (TODO, error string, etc.) | `query-codegraph` + `search_code` |
| Architecture / impact / cycles / orphans / hotspots | `analyze-codegraph` |
| Refactor to Modular MVC + Service + Repository | `modular-mvc-refactor` |
| Export Mermaid / DOT / JSON / Markdown / HTML | `export-codegraph` |
| Interactive graph visualization | `open-codegraph-ui` |

## Workflow

1. Classify request (structure? lookup? search? impact? refactor? export? visualize?).
2. If graph missing/stale, use `scan-codegraph` first.
3. Route to appropriate skill per matrix above.
4. Read source files only after graph identifies precise targets.

## Red flags

- Graph missing: run `scan-codegraph` before proceeding
- Graph stale: user reports recent changes not reflected; suggest rescan
- User asks for grep/find/Explore before graph: redirect to graph-backed skill first
- Ambiguous request: ask for clarification before routing

## Output contract

State which skill handles request and why. Keep answers graph-backed: file paths, symbols, nodes, edges, uncertainty noted. Example:

```
Request: "Who calls the auth middleware?"
Route: query-codegraph
Answer:
- src/routes/auth.ts:authMiddleware called by:
  1. src/server.ts:setupRoutes (line 42)
  2. src/routes/admin.ts:adminRoutes (line 15)
```