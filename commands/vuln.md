---
description: Scan dependencies for known CVEs and generate SBOM
allowed-tools: Bash, Read
---
Invoke the `coder-workflow:vulnerability-scanner` agent. Commands:
- `coder-workflow vuln-scan` — scan for CVEs
- `coder-workflow sbom --format spdx|cyclonedx` — generate SBOM
Or via MCP: `scan_vulnerabilities`, `generate_sbom`.
