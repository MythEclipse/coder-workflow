---
name: auditor
description: This skill should be used when the user asks to "audit architecture", "review layer violations", "find fat controllers", "cek struktur controller service repository", "assess refactor risk", or wants a read-only review of coding workflow, Modular MVC layering, coupling, and verification gaps.
version: 0.1.0
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(npm:*), Bash(node:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*), mcp__codegraph__*, mcp__code-review-graph__*
---

Perform a read-only audit of code structure, layering, refactor risk, and verification readiness. Produce actionable findings with file paths and line numbers. If the user requests code modifications, instruct them to switch to a developer implementation skill.

## Audit workflow

1. **Define scope**
   - Use the user-provided path, module, PR, or feature as the audit boundary.
   - If no scope is provided, inspect project entry points, route registration, module folders, and recent git changes.
   - If the discovered scope exceeds 10 files or output context limits, halt the audit and ask the user to narrow the target path or focus on a specific module.
   - Use codegraph MCP tools for structural analysis before any file reads. Prefer `query_graph` for dependency/caller/callee chains, `analyze_impact` for blast radius, `summarize_architecture` for module boundaries, and `search_code` for exact text patterns. Raw grep/find are fallbacks only after graph tools cannot answer.

2. **Map architecture**
   - Identify the most likely audit boundary first from the user prompt, then inspect only the smallest relevant slice of the codebase.
   - Identify routes, controllers, services, repositories, schemas, shared infrastructure, and tests that are directly connected to that slice.
   - Note whether the project is feature-first (`modules/user/...`) or layer-first (`controllers/`, `services/`, `repositories/`).
   - Detect framework conventions before judging structure.
   - Map the architecture and list paths first.
   - If the discovered scope exceeds 10 files or output context limits, halt the audit and ask the user to narrow the target path or focus on a specific module.
   - Stop after the map and ask the user to confirm the scope before any detailed violation scanning.
   - Do not proceed to violation scanning until the scope is confirmed.

3. **Find violations**
   - Controller performs ORM/SQL/database calls.
   - Controller contains business decisions, hashing, pricing, authorization decisions, or heavy branching.
   - Service imports HTTP request/response types or accesses `req`/`res`.
   - Service calls ORM/model/database directly when a repository layer exists or is expected.
   - Repository contains business decisions or HTTP concerns.
   - Validation schema is inline inside handlers instead of boundary schema/middleware.
   - Shared infrastructure imports feature modules.
   - Feature modules import another module’s repository/controller directly.
   - Circular dependencies or high-coupling modules increase migration risk.

4. **Assess workflow quality**
   - Check whether package scripts expose typecheck, lint, test, and app run commands.
   - Identify missing verification for changed areas.
   - Flag risky edits that require plan mode before implementation.

## Severity guide

- **High**: behavior risk, public contract risk, circular dependency, controller/service touching database in multiple paths, missing validation on unsafe input.
- **Medium**: layer leak that complicates refactor, duplicated business rules, shared/module direction violation.
- **Low**: naming/layout inconsistency, incomplete tests, documentation mismatch, small cleanup target.

## Output format

Return:

1. **Scope audited**: paths and assumptions.
2. **Architecture map**: layer/file overview.
3. **Findings**: severity, `file:line`, evidence, impact, recommended fix.
4. **Refactor sequence**: safest order of changes.
5. **Verification plan**: exact commands or manual checks to run.
6. **Open questions**: only decisions that block safe implementation.

## Boundaries

- Keep the audit read-only.
- Do not recommend large rewrites when small layer extraction works.
- Do not treat framework-specific conventions as violations without evidence.
- Do not hide uncertainty; label assumptions clearly.

## Additional resources

- `references/audit-checklist.md` contains a compact checklist for layer and workflow audits.

## Execution guardrail

- Keep the first pass limited to architecture mapping and scope confirmation.
- Do not attempt detailed violation scanning until the scope is confirmed.
- If scope remains broad or ambiguous, pause and request a narrower path instead of expanding analysis.
