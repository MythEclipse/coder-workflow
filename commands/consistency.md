---
description: Enforce code and style consistency across the codebase — naming, patterns, conventions
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(consistency-enforce): Detect and fix consistency violations

∴ Workflow({
  name: 'consistency-enforce',
  description: 'Enforce naming conventions, patterns, and style consistency across codebase',
  phases: [
    { title: 'Discover',  detail: 'scan for inconsistencies: naming, patterns, imports, style' },
    { title: 'Fix',       detail: '1 fixer agent per inconsistency category — all parallel' },
    { title: 'Verify',    detail: 'confirm violations resolved, no regressions' },
  ],
})

phase('Discover')
const [namingIssues, patternIssues, importIssues, styleIssues] = await parallel([
  () => agent(
    `Find naming inconsistencies: camelCase vs snake_case, PascalCase violations,
    inconsistent abbreviations, plural/singular confusion.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'naming-scan', phase: 'Discover', skill: 'quality-guardian' }
  ),
  () => agent(
    `Find structural pattern inconsistencies: modules using different architectural patterns,
    services without interfaces, repositories without base class.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'pattern-scan', phase: 'Discover', skill: 'quality-guardian' }
  ),
  () => agent(
    `Find import inconsistencies: mixed default/named exports, circular imports,
    barrel index files missing, path alias not used.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'import-scan', phase: 'Discover', skill: 'quality-guardian' }
  ),
  () => agent(
    `Find style inconsistencies: mixed quote styles, inconsistent semicolons,
    trailing commas, line length violations, indent width.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'style-scan', phase: 'Discover', skill: 'quality-guardian' }
  ),
])

phase('Fix')
const [namingFix, patternFix, importFix, styleFix] = await parallel([
  () => agent(
    `Fix all naming inconsistencies. Apply project-wide rename safely.
    Issues: ${namingIssues}`,
    { label: 'naming-fix', phase: 'Fix', agent: 'coder-workflow:refactoring-engineer' }
  ),
  () => agent(
    `Fix all structural pattern inconsistencies. Add missing interfaces/base classes.
    Issues: ${patternIssues}`,
    { label: 'pattern-fix', phase: 'Fix', agent: 'coder-workflow:refactoring-engineer' }
  ),
  () => agent(
    `Fix import inconsistencies. Update barrel files, fix path aliases, resolve circular imports.
    Issues: ${importIssues}`,
    { label: 'import-fix', phase: 'Fix', agent: 'coder-workflow:refactoring-engineer' }
  ),
  () => agent(
    `Auto-fix style inconsistencies via biome/eslint --fix. Do not manually rewrite files for style.
    Issues: ${styleIssues}`,
    { label: 'style-fix', phase: 'Fix', skill: 'quality-guardian' }
  ),
])

phase('Verify')
const verify = await agent(
  `Re-run consistency scan to confirm all violations resolved.
  Also run: typecheck + lint to confirm no regressions introduced.
  Fixes applied: ${[namingFix, patternFix, importFix, styleFix].map(r => r.label).join(', ')}`,
  { label: 'consistency-verify', phase: 'Verify', skill: 'quality-guardian' }
)

return { verify, categoriesFixed: 4 }
```
