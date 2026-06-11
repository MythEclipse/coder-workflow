---
description: DevOps — Docker, CI/CD, Traefik, VPS deployment, sprint metrics, benchmarks
argument-hint: [deploy-target-or-task]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(devops-deploy): Infrastructure provisioning + deployment pipeline

∴ Workflow({
  name: 'devops-deploy',
  description: 'Docker, CI/CD, infra-as-code, or deployment for: $ARGUMENTS',
  phases: [
    { title: 'Discover',  detail: 'scan current infra config, identify gaps' },
    { title: 'Provision', detail: 'parallel: Docker + CI + env configs' },
    { title: 'Verify',    detail: 'dry-run / validate configs, check secrets exposure' },
  ],
})

phase('Discover')
const [infraState, secretCheck] = await parallel([
  () => agent(
    `Scan current infrastructure config: Dockerfile(s), docker-compose, CI/CD files,
    env vars, deployment scripts. Scope: ${$ARGUMENTS || 'full project'}.
    Identify gaps vs target deployment state.`,
    { label: 'infra-scan', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__scan_secrets on infra files: Dockerfile, .env*, CI YAML, compose files.
    Flag any hardcoded credentials or secrets that should be in vault/env.`,
    { label: 'secret-preflight', phase: 'Discover', agent: 'coder-workflow:secret-scanner' }
  ),
])

phase('Provision')
const [dockerResult, ciResult, envResult] = await parallel([
  () => agent(
    `Generate/update Dockerfile + docker-compose.yml. Multi-stage build, minimal image, 
    non-root user, health checks. Infra state: ${infraState}`,
    { label: 'docker', phase: 'Provision', agent: 'coder-workflow:devops-engineer' }
  ),
  () => agent(
    `Generate/update CI/CD pipeline (GitHub Actions / GitLab CI).
    Include: lint, test, build, docker push, deploy stages.
    Infra state: ${infraState}`,
    { label: 'ci-cd', phase: 'Provision', agent: 'coder-workflow:devops-engineer' }
  ),
  () => agent(
    `Generate .env.example + docker secrets configuration.
    Resolve all flagged secrets: ${secretCheck}`,
    { label: 'env-config', phase: 'Provision', agent: 'coder-workflow:devops-engineer' }
  ),
])

phase('Verify')
const verify = await agent(
  `Validate all generated configs:
  - Docker: syntax check, no ADD when COPY works, non-root user present
  - CI: all jobs have proper triggers, no hardcoded tokens
  - Env: .env.example covers all referenced vars, no secrets committed
  Generated: ${[dockerResult, ciResult, envResult].map(r => r.label).join(', ')}`,
  { label: 'infra-verify', phase: 'Verify', agent: 'coder-workflow:devops-engineer' }
)

return { verify, configsProvisioned: 3 }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
