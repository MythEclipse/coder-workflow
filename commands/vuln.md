---
description: CVE vulnerability scan and SBOM generation for dependency risk assessment
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(vuln-sbom-scan): CVE scan + SBOM generation

∴ Workflow({
  name: 'vuln-sbom-scan',
  description: 'Scan dependencies for CVEs, generate SBOM, assess risk surface',
  phases: [
    { title: 'Inventory', detail: 'map all dependencies + generate SBOM' },
    { title: 'Scan',      detail: 'parallel: CVE scan + license risk + transitive deps' },
    { title: 'Report',    detail: 'CVSS-ranked findings + remediation path' },
  ],
})

phase('Inventory')
const [sbom, depTree] = await parallel([
  () => agent(
    `Generate Software Bill of Materials (SBOM) in CycloneDX/SPDX format.
    Use mcp__codegraph__generate_sbom or parse package.json/go.mod/requirements.txt.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'sbom-gen', phase: 'Inventory', skill: 'vulnerability-scanner' }
  ),
  () => agent(
    `Build full dependency tree including transitive dependencies.
    Identify: direct vs transitive, version pins, floating versions.
    Scope: ${$ARGUMENTS || 'full project'}`,
    { label: 'dep-tree', phase: 'Inventory', skill: 'vulnerability-scanner' }
  ),
])

phase('Scan')
const [cveFindings, licenseRisks, outdatedDeps] = await parallel([
  () => agent(
    `Run mcp__codegraph__scan_vulnerabilities against the SBOM.
    Return all CVEs with CVSS score, affected package+version, fixed version.
    SBOM: ${sbom}`,
    { label: 'cve-scan', phase: 'Scan', skill: 'vulnerability-scanner' }
  ),
  () => agent(
    `Run mcp__codegraph__check_licenses. Flag: GPL in commercial project, AGPL, unknown licenses.
    Dependency tree: ${depTree}`,
    { label: 'license-scan', phase: 'Scan', skill: 'vulnerability-scanner' }
  ),
  () => agent(
    `Identify outdated dependencies with available major-version upgrades.
    Flag any with known breaking changes or end-of-life status.
    Dependency tree: ${depTree}`,
    { label: 'outdated-scan', phase: 'Scan', skill: 'vulnerability-scanner' }
  ),
])

phase('Report')
const report = await agent(
  `Produce final vulnerability report:
  1. CRITICAL CVEs (CVSS ≥9.0): immediate action required
  2. HIGH CVEs (CVSS 7.0–8.9): fix before next release
  3. MEDIUM/LOW CVEs: tracked
  4. License violations
  5. Upgrade roadmap for outdated deps
  CVEs: ${cveFindings}
  Licenses: ${licenseRisks}
  Outdated: ${outdatedDeps}`,
  { label: 'vuln-report', phase: 'Report' }
)

return { report, sbom, criticalCves: cveFindings.critical }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
