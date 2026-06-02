---
name: auditor
description: This skill should be used when the user asks to "audit architecture", "review layer violations", "find fat controllers", "cek struktur controller service repository", "assess refactor risk", or wants a read-only review of coding workflow, Modular MVC layering, coupling, and verification gaps.
version: 0.1.0
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(npm:*), Bash(node:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*), mcp__codegraph__*, mcp__code-review-graph__*
---

Perform a read-only audit of code structure, layering, refactor risk, and verification readiness. Produce actionable findings with file paths and line numbers. If the user requests code modifications, instruct them to switch to a developer implementation skill.

This skill is the entry point — it delegates the full audit process to the `architecture-auditor` agent, which owns all scope management, violation definitions, severity levels, and output format. Do not duplicate or override those rules here.

## Audit workflow

1. **Define scope**
   - Use the user-provided path, module, PR, or feature as the audit boundary.
   - If no scope is provided, inspect project entry points, route registration, module folders, and recent git changes.
   - Pass the scope to the `architecture-auditor` agent — do not apply arbitrary file count caps here. The agent manages iterative decomposition for large codebases.

2. **Delegate to architecture-auditor agent**
   - Invoke the `architecture-auditor` agent with the identified scope.
   - Provide: scope path(s), framework detected, any specific violation types the user asked about.
   - The agent will map architecture, scan violations, assess refactor risk, and produce findings with file:line evidence.

3. **Find violations** *(reference — agent executes these, not this skill)*
   - Controller performs ORM/SQL/database calls.
   - Controller contains business decisions, hashing, pricing, authorization decisions, or heavy branching.
   - Service imports HTTP request/response types or accesses `req`/`res`.
   - Service calls ORM/model/database directly when a repository layer exists or is expected.
   - Repository contains business decisions or HTTP concerns.
   - Validation schema is inline inside handlers instead of boundary schema/middleware.
   - Shared infrastructure imports feature modules.
   - Feature modules import another module's repository/controller directly.
   - Circular dependencies or high-coupling modules increase migration risk.

4. **Assess workflow quality** *(reference — agent executes these)*
   - Check whether package scripts expose typecheck, lint, test, and app run commands.
   - Identify missing verification for changed areas.
   - Flag risky edits that require plan mode before implementation.

## Severity guide

- **High**: behavior risk, public contract risk, circular dependency, controller/service touching database in multiple paths, missing validation on unsafe input.
- **Medium**: layer leak that complicates refactor, duplicated business rules, shared/module direction violation.
- **Low**: naming/layout inconsistency, incomplete tests, documentation mismatch, small cleanup target.

## Output format

Return (produced by architecture-auditor agent):

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

- Do not attempt detailed violation scanning in this skill — delegate to `architecture-auditor` agent.
- If scope is unclear after initial prompt analysis, pass it to the agent with a note — let the agent decide whether to clarify or proceed with conservative scope.


---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**


> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via explorer subagents instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
