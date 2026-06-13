---
description: DevOps — Docker, CI/CD, Traefik, VPS deployment, sprint metrics, benchmarks
argument-hint: [deploy-target-or-task]
allowed-tools: Read, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
Run concurrently:
  - Scan current infrastructure config: Dockerfile(s), docker-compose, CI/CD files, env vars, deployment scripts. Scope: [results from previous phase]. Identify gaps vs target deployment state.,
  - Run your graph/mapping tools on infra files: Dockerfile, .env*, CI YAML, compose files. Flag any hardcoded credentials or secrets that should be in vault/env.,

### Phase: Provision
Run concurrently:
  - Generate/update Dockerfile + docker-compose.yml. Multi-stage build, minimal image, non-root user, health checks. Infra state: [results from previous phase],
  - Generate/update CI/CD pipeline (GitHub Actions / GitLab CI). Include: lint, test, build, docker push, deploy stages. Infra state: [results from previous phase],
  - Generate .env.example + docker secrets configuration. Resolve all flagged secrets: [results from previous phase],

### Phase: Verify
- Validate all generated configs: - Docker: syntax check, no ADD when COPY works, non-root user present - CI: all jobs have proper triggers, no hardcoded tokens - Env: .env.example covers all referenced vars, no secrets committed Generated: [results from previous phase]

```

