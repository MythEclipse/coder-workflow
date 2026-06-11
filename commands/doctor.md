---
description: Dev environment and project health check — dependencies, config, tools
argument-hint: []
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(doctor-check): Dev environment + project health diagnostic

∴ Workflow({
  name: 'doctor-check',
  description: 'Full health check: tools, deps, config, CodeGraph status, env vars',
  phases: [
    { title: 'Diagnose', detail: 'parallel: tool versions + dep state + config + graph status' },
    { title: 'Report',   detail: 'health score + actionable fix list' },
  ],
})

phase('Diagnose')
const [toolCheck, depCheck, configCheck, graphCheck] = await parallel([
  () => agent(
    `Check tool versions: node, npm/pnpm/bun, git, docker, required CLIs.
    Compare against .nvmrc/.node-version, engines field in package.json.`,
    { label: 'tool-check', phase: 'Diagnose', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Check dependency health: run npm ci --dry-run, check for missing deps,
    check node_modules vs package-lock.json sync, detect phantom deps.`,
    { label: 'dep-check', phase: 'Diagnose', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Check configuration files: tsconfig.json validity, biome.json, .env completeness vs .env.example.
    Run mcp__codegraph__validate_env_file if available.`,
    { label: 'config-check', phase: 'Diagnose', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Check CodeGraph status: run mcp__codegraph__doctor. Is DB present, up to date, scanning correctly?
    Report graph age and node count.`,
    { label: 'graph-check', phase: 'Diagnose', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Report')
const report = await agent(
  `Produce doctor report: health score (0-100), grouped by category.
  ✅ PASS / ⚠️ WARN / ❌ FAIL for each check.
  Actionable fix commands for each failure.
  Tools: ${toolCheck}
  Deps: ${depCheck}
  Config: ${configCheck}
  Graph: ${graphCheck}`,
  { label: 'doctor-report', phase: 'Report' }
)

return { report }
```
