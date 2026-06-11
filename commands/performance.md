---
description: Bundle size analysis and performance audit — LCP, Core Web Vitals, perf budget
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(perf-audit): Bundle size + performance audit

∴ Workflow({
  name: 'perf-audit',
  description: 'Bundle analysis, performance budget check, optimization recommendations',
  phases: [
    { title: 'Measure', detail: 'parallel: bundle analysis + dependency weight + build metrics' },
    { title: 'Analyze', detail: 'identify regressions, large deps, tree-shaking gaps' },
    { title: 'Report',  detail: 'perf budget status + optimization roadmap' },
  ],
})

phase('Measure')
const [bundleData, depWeights, buildMetrics] = await parallel([
  () => agent(
    `Run mcp__codegraph__analyze_bundle on scope: ${$ARGUMENTS || 'full project'}.
    Return: total bundle size, chunk breakdown, largest modules.`,
    { label: 'bundle-analysis', phase: 'Measure', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Analyze dependency weights: find packages contributing most to bundle size.
    Check: duplicate packages, large polyfills, unused peer deps.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'dep-weights', phase: 'Measure', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Collect build metrics: build time, chunk count, async chunks, CSS size.
    Compare with previous build if cached stats available.`,
    { label: 'build-metrics', phase: 'Measure', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Analyze')
const analysis = await agent(
  `Analyze performance posture:
  - Is bundle within budget? (target: ≤200KB gzipped initial chunk)
  - Which imports prevent tree-shaking?
  - Any duplicate modules (same lib, different versions)?
  - Code splitting opportunities?
  Bundle: ${bundleData}
  Deps: ${depWeights}
  Build: ${buildMetrics}`,
  { label: 'perf-analysis', phase: 'Analyze', agent: 'coder-workflow:explore-codebase' }
)

phase('Report')
const report = await agent(
  `Produce performance report:
  1. Budget status: PASS / WARN / FAIL with delta
  2. Top 5 largest dependencies + replacement candidates
  3. Code splitting opportunities ranked by impact
  4. Quick wins (easy optimizations)
  Analysis: ${analysis}`,
  { label: 'perf-report', phase: 'Report' }
)

return { report }
```
