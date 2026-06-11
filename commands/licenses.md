---
description: Dependency license compliance scan
argument-hint: [scope-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(license-scan): Dependency license compliance audit

∴ Workflow({
  name: 'license-scan',
  description: 'Scan all dependencies for license compliance risks',
  phases: [
    { title: 'Scan',   detail: 'parallel: direct + transitive license extraction' },
    { title: 'Report', detail: 'compliance matrix + flagged violations' },
  ],
})

phase('Scan')
const [directLicenses, transitiveLicenses] = await parallel([
  () => agent(
    `Run mcp__codegraph__check_licenses on direct dependencies.
    Return: package name | version | license SPDX ID | compliance status.`,
    { label: 'direct-licenses', phase: 'Scan', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__check_licenses on transitive (indirect) dependencies.
    Flag: GPL-2.0, GPL-3.0, AGPL, SSPL, CC-BY-NC — copyleft risk in commercial projects.`,
    { label: 'transitive-licenses', phase: 'Scan', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Report')
const report = await agent(
  `License compliance report:
  1. VIOLATION: copyleft licenses incompatible with project license
  2. REVIEW: licenses requiring attribution or notification
  3. COMPLIANT: MIT, Apache-2.0, BSD, ISC — safe to use
  4. UNKNOWN: packages with missing/custom licenses
  5. Remediation: alternatives for flagged packages
  Direct: ${directLicenses}
  Transitive: ${transitiveLicenses}`,
  { label: 'license-report', phase: 'Report' }
)

return { report }
```
