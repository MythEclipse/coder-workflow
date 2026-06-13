---
description: CVE vulnerability scan and SBOM generation for dependency risk assessment
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Inventory
Run concurrently:
  - Generate Software Bill of Materials (SBOM) in CycloneDX/SPDX format. Use your graph/mapping tools or parse package.json/go.mod/requirements.txt. Scope: [results from previous phase],
  - Build full dependency tree including transitive dependencies. Identify: direct vs transitive, version pins, floating versions. Scope: [results from previous phase],

### Phase: Scan
Run concurrently:
  - Run your graph/mapping tools against the SBOM. Return all CVEs with CVSS score, affected package+version, fixed version. SBOM: [results from previous phase],
  - Run your graph/mapping tools. Flag: GPL in commercial project, AGPL, unknown licenses. Dependency tree: [results from previous phase],
  - Identify outdated dependencies with available major-version upgrades. Flag any with known breaking changes or end-of-life status. Dependency tree: [results from previous phase],

### Phase: Report
- Produce final vulnerability report: 1. CRITICAL CVEs (CVSS ≥9.0): immediate action required 2. HIGH CVEs (CVSS 7.0–8.9): fix before next release 3. MEDIUM/LOW CVEs: tracked 4. License violations 5. Upgrade roadmap for outdated deps CVEs: [results from previous phase] Licenses: [results from previous phase] Outdated: [results from previous phase]

```

