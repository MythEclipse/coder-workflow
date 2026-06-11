---
description: Documentation generation — README, API specs, inline docs, architecture guides
argument-hint: [scope-or-doc-type]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(docs-generation): Generate/sync documentation for project scope

∴ Workflow({
  name: 'docs-generation',
  description: 'Generate README, API specs, inline docs, and architecture guides from live code',
  phases: [
    { title: 'Discover',  detail: 'CodeGraph scan — map exported APIs, public interfaces' },
    { title: 'Generate',  detail: 'parallel: README + API docs + inline comments + arch guide' },
    { title: 'Verify',    detail: 'confirm all public interfaces are documented, no stale refs' },
  ],
})

phase('Discover')
const [apiMap, archSummary] = await parallel([
  () => agent(
    `Map all public APIs, exported functions, and interfaces in scope: ${$ARGUMENTS || 'full project'}.
    Use mcp__codegraph__query_graph. Include: function signatures, return types, param descriptions.`,
    { label: 'api-map', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Generate architecture summary via mcp__codegraph__summarize_architecture.
    Return: module boundaries, data flow, key decisions, tech stack.`,
    { label: 'arch-summary', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Generate')
const [readmeResult, apiDocsResult, inlineResult] = await parallel([
  () => agent(
    `Generate or update README.md: project overview, setup, usage, architecture diagram reference.
    Architecture: ${archSummary}
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'readme', phase: 'Generate', agent: 'coder-workflow:docs-engineer' }
  ),
  () => agent(
    `Generate API documentation (OpenAPI/markdown) from mapped interfaces.
    API map: ${apiMap}`,
    { label: 'api-docs', phase: 'Generate', agent: 'coder-workflow:docs-engineer' }
  ),
  () => agent(
    `Add/update inline JSDoc/TSDoc comments for all undocumented exported functions.
    API map: ${apiMap}`,
    { label: 'inline-docs', phase: 'Generate', agent: 'coder-workflow:docs-engineer' }
  ),
])

phase('Verify')
const verify = await agent(
  `Verify documentation completeness:
  - All exported APIs have JSDoc
  - README is up to date with actual project structure
  - No stale or broken cross-references
  Generated: ${[readmeResult, apiDocsResult, inlineResult].map(r => r.label).join(', ')}`,
  { label: 'docs-verify', phase: 'Verify', agent: 'coder-workflow:docs-engineer' }
)

return { verify, docsGenerated: 3 }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
