# Modular MVC Refactor — Reference Guide

## Delegation Target

This skill delegates to the canonical **`refraktor`** skill from the `coder-workflow` plugin.

## Pre-Flight Checklist

Before delegating to `refraktor`:

- [ ] `.codegraph/graph.db` exists and is current
- [ ] `analyze-codegraph` has been run for architecture overview
- [ ] `query-graph` has been used to identify callers/callees of affected modules
- [ ] Cycles identified via `find_cycles`
- [ ] Orphans identified via `find_orphans`
- [ ] Hotspots identified via `summarize_architecture`

## What Graph Analysis Provides to Refactoring

| Graph Analysis | Refactoring Value |
|---------------|------------------|
| `summarize_architecture` | Current module boundaries, entry points, shared infrastructure |
| `analyze_impact` | Which files will break if moved — plan migration order |
| `find_cycles` | Circular dependencies that must be broken before module extraction |
| `find_orphans` | Dead code to remove before refactoring |
| `query_graph` callers | Who calls each function — update import paths correctly |
| `summarize_graph` | Scale of the codebase — batch size planning |

## Layer Contract

```
Route → Controller → Service → Repository → Schema
```

| Layer | Owns | Must Not |
|-------|------|----------|
| Route | HTTP method + path declarations | Business logic, DB queries, validation |
| Controller | Parse req → call service → send res | DB queries, hashing, calculations, ORM |
| Service | Business logic, decisions, orchestration | HTTP req/res, raw ORM queries, SQL |
| Repository | All DB interaction: CRUD, joins, transactions | Business logic, HTTP concerns |
| Schema | Input validation, data contracts | Side effects, DB access, business decisions |

## Cross-Module Rules

- Module A imports from Module B **only through Module B's service**
- Never import another module's repository or controller directly
- Break circular dependencies by extracting to `shared/utils/` or creating a domain service

## Verification Gates After Each Module

1. Typecheck clean
2. Lint clean
3. Tests passing (affected module → full suite)
4. `analyze-codegraph` confirms no broken callers
5. Zero circular dependencies

## Common Refactoring Patterns

| Current | Target | Notes |
|---------|--------|-------|
| Flat `controllers/` folder | `modules/<feature>/*.controller.ts` | Group by feature, not technical layer |
| Controller with ORM calls | Extract to `*.repository.ts` | One method per DB operation |
| Controller with business logic | Extract to `*.service.ts` | Service never touches req/res |
| Inline validation | Extract to `*.schema.ts` | Wire as middleware or first controller call |
| Global `utils/` mixing concerns | Split: shared utils + module-local helpers | Shared must not import from modules |
