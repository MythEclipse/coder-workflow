---
name: analyze-codegraph
description: Analyze architecture, impact, risk, cycles, orphans, hotspots using graph. Use before grep/find/Explore for architecture questions, refactor planning, PR impact review, or blast-radius analysis. Skip only for known single-file reads.
version: 0.2.0
---

# Analyze CodeGraph

Graph-backed architecture, impact, dependency risk, and hotspot analysis. Inspect files only after graph evidence.

## CORE RULE

Separate graph evidence from inference. Graph shows structure; inference explains why. Always cite which is which. Never skip graph analysis for architecture/impact/risk questions—use it first, then read files to confirm or explain findings.

## Trigger

**Use this skill when:**
- User asks about architecture, project structure, dependencies, modules
- Need to assess impact, risk, refactor blast radius, change scope
- Finding cycles, orphans, hotspots, complex modules, fat controllers
- Planning refactor or reviewing PR impact
- Identifying layer violations, cross-module coupling, shared infrastructure

**Trigger even when the user does not mention CodeGraph or MCP.** If question is about architecture, impact, or dependency risk, use graph first before grep/find/Explore agents.

**Skip only for:**
- Single known file read: "open src/foo.ts"
- Exact literal text search: "find string TODO_AUTH"

## Do not use

- Do not read files before querying graph for structure
- Do not skip graph analysis for "quick" architecture questions
- Do not confuse high degree (many connections) with bad design—report both signal and context
- Do not batch dependent analyses (e.g., impact of A then impact of B if B depends on A result)

## Workflow

1. Verify `.codegraph/graph.db` exists. If missing, use `scan-codegraph` first.

2. Choose analysis type:
   - **Impact:** `analyze_impact` for upstream/downstream, direct vs transitive
   - **Cycles:** `find_cycles` for circular dependencies
   - **Orphans:** `find_orphans` for unused files/symbols
   - **Hotspots:** `summarize_architecture` for high-degree nodes, centrality
   - **Architecture:** `summarize_architecture` for entry points, modules, boundaries

3. For targeted impact, resolve user-provided file/symbol/class/function to graph node.

4. Traverse upstream (dependents) and downstream (dependencies) separately. Rank by relationship strength, edge type, distance.

5. Cite graph evidence: "Graph shows X has Y inbound edges" vs inference: "This suggests Z because..."

6. Read source files only for high-confidence explanation or exact code references.

7. If analysis reveals layer violations (fat controllers with DB calls, services without repository abstraction, missing validation layer, flat global folder layout), produce refactor readiness report and recommend `modular-mvc-refactor` skill.

## Analysis types

**Impact:** Follow inbound dependents and outbound dependencies. Separate direct from transitive impact. Report risk level with reason.

**Cycles:** Find strongly connected components. Report shortest cycle paths first.

**Orphans:** Identify files/symbols with no useful inbound/outbound edges. Exclude entry points, configs, scripts, docs, tests, generated files unless user asks.

**Hotspots:** Rank nodes by degree, centrality, fan-in, fan-out, mixed edge types. High degree = review signal, not proof of bad design.

**Architecture:** Group nodes by directories/packages/modules. Identify entry points, shared infrastructure, core domains, adapters, external boundaries.

## Red flags

- Graph missing or stale: use `scan-codegraph` first
- User asks "is this a problem?" without graph evidence: run analysis before answering
- Confusing high degree with bad design: always provide context
- Skipping graph for "obvious" questions: graph catches surprises

## Output contract

**Impact analysis:**
- Target node (graph evidence)
- Direct upstream dependents (count, examples)
- Direct downstream dependencies (count, examples)
- Transitive affected areas (scope, risk)
- Risk level with reason (evidence vs inference)
- Suggested files to inspect first

**Architecture analysis:**
- Entry points (graph evidence)
- Core modules (by degree, centrality)
- Shared dependencies (fan-in hotspots)
- External boundaries (adapter layers)
- Hotspots (high-degree nodes with context)
- Risks (layer violations, cycles, orphans)

Always distinguish graph evidence from inference in output.

