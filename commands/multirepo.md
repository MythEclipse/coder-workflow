---
description: Multi-repo orchestration — cross-service changes, microservice coordination
argument-hint: [repos-or-task]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(multirepo-orchestrate): Cross-service multi-repo orchestration

∴ Workflow({
  name: 'multirepo-orchestrate',
  description: 'Coordinate changes across multiple repos/services: $ARGUMENTS',
  phases: [
    { title: 'Map',      detail: 'parallel: scan each repo + identify cross-service contracts' },
    { title: 'Plan',     detail: 'multi-repo-orchestrator produces coordinated change plan' },
    { title: 'Swarm',    detail: '1 implementer per repo — fully parallel, independent branches' },
    { title: 'Verify',   detail: 'confirm all repos are consistent, contracts honored' },
    { title: 'Synthesize', detail: 'produce unified PR/change summary' },
  ],
})

phase('Map')
const repoMaps = await parallel(
  // For each repo in scope, spawn a parallel explorer
  ($ARGUMENTS || '').split(',').map(repo => () => agent(
    `Map repository: ${repo.trim()}. 
    Use mcp__codegraph__cross_repo_search to find relevant APIs and contracts.
    Return: public APIs, types exported, inter-service dependencies.`,
    { label: `map-${repo.trim()}`, phase: 'Map', agent: 'coder-workflow:explore-codebase' }
  ))
)

phase('Plan')
const crossRepoPlan = await agent(
  `Produce coordinated change plan for: $ARGUMENTS
  Across all repos. Identify: shared contract changes, migration order, breaking change risk.
  Repo maps: ${JSON.stringify(repoMaps)}`,
  { label: 'cross-repo-plan', phase: 'Plan', agent: 'coder-workflow:multi-repo-orchestrator' }
)

phase('Swarm')
const repoResults = await parallel(
  crossRepoPlan.tasks.map(task => () => agent(
    task.prompt,
    { label: task.label, phase: 'Swarm', agent: task.agent }
  ))
)

phase('Verify')
const verify = await agent(
  `Verify cross-repo consistency: all contract changes are honored across all repos,
  no service depends on a deleted API, all integration tests pass.
  Results: ${JSON.stringify(repoResults)}`,
  { label: 'cross-repo-verify', phase: 'Verify', agent: 'coder-workflow:architecture-auditor' }
)

phase('Synthesize')
const report = await agent(
  `Produce unified multi-repo change summary: one PR description per repo,
  shared changelog entry, migration guide for consumers.
  Results: ${JSON.stringify(repoResults)}
  Verify: ${verify}`,
  { label: 'multirepo-report', phase: 'Synthesize' }
)

return { report, repoCount: repoResults.length }
```
