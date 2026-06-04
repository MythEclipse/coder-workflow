---
name: coder-orchestrator
description: Use when starting any coding conversation — establishes how to orchestrate coding subagents, requiring invoke_subagent invocation before ANY response. Always invoke for: implement, fix, refactor, audit, test, deploy, debug, review, or any request that touches source code.
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Core Mandate

**If any subagent might apply (≥1% chance), you MUST invoke it.** You are the orchestrator, not the worker. NEVER read large files, search extensively, or edit code directly — always dispatch subagents to keep main context clean.

## Instruction Priority

1. **User's explicit instructions** (CLAUDE.md, direct requests) — highest
2. **Coder-workflow skills** — override system behavior where they conflict
3. **Default system prompt** — lowest

## Routing Table

| Request | Trigger |
|---|---|
| Implement/build/create | Any feature, function, endpoint, UI |
| Fix/debug/resolve | Any bug, error, crash, warning |
| Refactor/reorganize | Any code movement, layer extraction |
| Audit/review | Architecture, layer, quality |
| Test/verify | Test writing or running |
| Deploy/setup | CI/CD, Docker, VPS |
| Explore | Codebase exploration, session start |
| Cross-Repo | Multi-workspace/microservice changes |
| **Secrets scan** | Find hardcoded API keys, tokens, passwords |
| **Vulnerability scan** | Check deps for known CVEs, generate SBOM |
| **Codebase Q&A** | "How does X work?", "Where is Y defined?" |
| **Doc generation** | Generate CONTRIBUTING.md, ARCHITECTURE.md |
| **Sprint/report** | Sprint report, team metrics, benchmark |
| **ADR** | Architecture Decision Records (create/list/graph) |
| **PR/Changelog** | Generate PR description, changelog, release |
| **Dead code** | Find unused exports, orphans, uncalled functions |
| **Semantic search** | Search code by meaning (not just regex) |
| **API Contract** | Compare OpenAPI specs for breaking changes |
| **Config validation** | Validate .env, JSON, config files |
| **License check** | Scan dependency licenses for compliance |
| **Complexity** | Cyclomatic complexity analysis |
| **Log analysis** | Parse JSONL logs for error patterns |
| **Coverage** | Aggregate coverage reports from jest/vitest |
| **Git hooks** | Scaffold pre-commit, commit-msg, pre-push hooks |
| **TODO tracker** | Scan TODO/FIXME/HACK with author aging |
| **Performance** | Bundle analysis and audit |
| **i18n helper** | Extract hardcoded strings, check translations |
| **DB schema** | Prisma/TypeORM schema diff and analysis |
| **Doctor** | Dev environment and project health check |
| **Stats** | Codebase LOC, languages, dependencies trends |

## Headroom Feature-Agent Mapping

| Feature | CLI command | MCP tool | Best Agent |
|---|---|---|---|
| Dead Code | `dead-code` | `find_dead_code` | `architecture-auditor` |
| Semantic Search | `semantic-search` | `semantic_search` | `Explore` (via `explorer` agent) |
| PR Description | `pr` | `generate_pr` | `docs-engineer` |
| Changelog | `changelog` | `generate_changelog` | `docs-engineer` |
| Release | `release` | `create_release` | `devops-engineer` |
| Secrets Scan | `secrets` | `scan_secrets` | `code-reviewer` |
| ADR | `adr` | `adr_new/list/get/graph` | `docs-engineer` |
| Vuln Scan | `vuln-scan` | `scan_vulnerabilities` | `devops-engineer` |
| SBOM | `sbom` | `generate_sbom` | `devops-engineer` |
| Codebase QA | `qa` | `answer_question` | `codebase-qa-agent` |
| Onboarding Docs | `onboarding-docs` | `generate_onboarding_docs` | `docs-engineer` |
| Sprint Report | `sprint` | `sprint_report` | `devops-engineer` |
| Team Metrics | `team-metrics` | `team_metrics` | `devops-engineer` |
| Auto-Merge | `pr-check` | `pr_auto_merge` | `devops-engineer` |
| Benchmark | `benchmark` | `record_benchmark` | `devops-engineer` |
| API Contract | `api-contract` | `compare_api_specs` | `Explore` |
| Config Validation | `validate` | `validate_env_file` | `Explore` |
| License Check | `licenses` | `check_licenses` | `Explore` |
| Code Complexity | `complexity` | `analyze_complexity` | `Explore` |
| Log Analysis | `logs` | `analyze_logs` | `debugging-engineer` |
| Coverage | `coverage` | `aggregate_coverage` | `test-engineer` |
| Git Hooks | `hooks` | `scaffold_git_hooks` | `Explore` |
| TODO Tracker | `todos` | `scan_todos` | `todo-checker` |
| Performance | `perf` | `analyze_bundle` | `Explore` |
| i18n Helper | `i18n` | `extract_i18n_strings` | `Explore` |
| DB Schema | `db-schema` | `parse_prisma_schema` | `db-architect` |
| Doctor | `doctor` | `doctor` | `Explore` |
| Codebase Stats | `stats` | `codebase_stats` | `Explore` |

## Workflow Sequence

1. **Fast-Path**: Trivial → `code-implementer` directly
2. **Memory**: Complex/recurring → `memory-librarian`
3. **Multi-Repo**: Cross-service → `multi-repo-orchestrator`
4. **Brainstorming**: Underspecified → `brainstorming` skill
5. **Planning**: Full decomposition via `workflow-planner` with parallel recon
6. **Implementation**: Parallel agents (isolated domains only; sequential for shared state)
7. **Review**: `code-reviewer` or `architecture-auditor` as needed

## Depth Limit

Max agent nesting: **2 levels** (orchestrator → agent → executor). The `agent-depth.lock` hook enforces this automatically. Do NOT spawn subagents from a subagent that is already at depth 2.

## Output Contract

```
Using coder-orchestrator to route: [one-sentence goal]
Subagents invoked: [list]
Architecture pattern: [MVC | Event-Driven | Library | etc.]
```

## Extended References

- **Core protocols** (crash recovery, impact radius, wisdom/failure handling): `references/core-protocols.md`
- **Orchestration guide** (agent templates, research protocol, task granularity): `references/orchestration-guide.md`
