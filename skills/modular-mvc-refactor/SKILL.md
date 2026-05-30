---
name: modular-mvc-refactor
description: Refactor codebase toward Modular MVC + Service + Repository architecture. Use when user asks to reorganize by feature/module, separate controller/service/repository layers, fix fat controllers, add schema validation, or migrate from flat layout. Delegates to the canonical `refraktor` skill with graph-first pre-flight.
version: 0.4.0
---

# Modular MVC + Service + Repository Refactor (Graph-First Delegate)

This skill is a **graph-first pre-flight wrapper** around the canonical `refraktor` skill (from coder-workflow plugin). It ensures CodeGraph MCP tools are used for architecture analysis before delegating to the multi-language refactor skill.

## When this skill triggers

Same as `refraktor`: user asks to refactor to Modular MVC, separate Controller-Service-Repository layers, reorganize by feature/module, fix fat controllers, add schema validation, or migrate from flat layout.

## Workflow

### Phase 0 — Graph pre-flight (CodeGraph-specific)

1. Verify `.codegraph/graph.db` exists. If missing or stale, invoke `scan-codegraph`.
2. Run `analyze-codegraph` to map architecture, dependencies, cycles, orphans, and hotspots.
3. Run `query-codegraph` to find callers/callees, routes, handlers, and components affected by the refactor.

### Phase 1 — Delegate to canonical refactor

After graph pre-flight, invoke the **`refraktor`** skill from the coder-workflow plugin. The canonical skill handles:

- Stack detection (language, framework, ORM, validation, test runner, linter)
- Mandatory planning via `EnterPlanMode`
- Migration manifest creation and user approval
- Batch-by-batch structural refactoring
- Verification gates (typecheck, lint, tests)

Do NOT attempt to refactor directly — always delegate to `refraktor` after the graph pre-flight.

## Why two skills?

- `modular-mvc-refactor` (this skill) provides **graph-first pre-flight** specific to codegraph-mapper's MCP tools.
- `refraktor` (coder-workflow) is the **canonical multi-language refactor** skill with EnterPlanMode planning, stack detection, and safety rules.
- Together: graph analysis + comprehensive refactor planning = safer structural changes.

## Red flags

- Graph missing or stale → run `scan-codegraph` before anything
- No approved refactor plan → stop and enter plan mode via `refraktor`
- Typecheck, lint, or tests failing before refactor → stop and report blocker
- Cross-module repository imports detected during analysis → flag as architectural risk
