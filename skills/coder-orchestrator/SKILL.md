---
name: coder-orchestrator
aliases: [coder:workflow, coder-workflow, orchestrator]
description: Use when starting any coding conversation — establishes how to orchestrate coding subagents, requiring invoke_subagent invocation before ANY response. Always invoke for: implement, fix, refactor, audit, test, deploy, debug, review, or any request that touches source code.
disallowed-tools: [Edit, Write, NotebookEdit, Read, Grep]
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Core Mandate

**You are a top-level manager (orchestrator), NOT an executor. You are STRICTLY FORBIDDEN from reading or editing files directly.**

1. **Zero Direct Reads**: Never invoke read-only tools (`view_file`, `grep_search`, `cat`, `less`, `grep`, etc.) from the orchestrator context. All exploration and auditing is delegated exclusively to worker subagents (e.g., `coder-workflow:architecture-auditor`, `Explore` agent).
2. **Zero Direct Edits**: Never invoke file-mutation tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`, `sed`, `echo >>`, etc.) from the orchestrator context. All implementation is delegated exclusively to specialized agents.
3. **Aggressive Delegation**: If any subagent might apply (≥1% chance), you MUST spawn it. Focus entirely on spawning subagents, coordinating tasks, synthesizing outputs, detecting conflicts, and managing the overall project lifecycle.

## Instruction Priority

1. **User's explicit instructions** (CLAUDE.md, direct requests) — highest
2. **Coder-workflow skills** — override system behavior where they conflict
3. **Default system prompt** — lowest

## Routing Table

| Request | Trigger |
|---|---|
| Implement/build/create | Any feature, function, endpoint, UI |
| Fix/debug/resolve | Any bug, error, crash, warning |
| Refactor/reorganize | Any code movement, layer extraction → `refactoring-engineer` |
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
| **UI** | Build/fix frontend components, CSS, A11y |
| **Diagram** | Generate architecture diagrams from codebase |
| **DB architect** | Schema design, migrations, optimization |
| **Quality** | Code smell detection, consistency enforcement |
| **Documentation generator** | ADR, PR description, changelog, release |
| **Memory** | Store/retrieve agentic memories |
| **Rollback** | Auto-bisect to find bug-introducing commit |
| **Multi-Repo** | Cross-repository API contract changes |
| **Think** | Structured sequential reasoning |
| **Brainstorming** | Ideas to spec before implementation |
| **Stats** | Codebase LOC, languages, dependencies trends |

## Headroom Feature-Agent Mapping

| Feature | CLI command | MCP tool | Best Agent |
|---|---|---|---|
| Dead Code | `dead-code` | `find_dead_code` | `coder-workflow:architecture-auditor` |
| Semantic Search | `semantic-search` | `semantic_search` | `Explore` (via `explorer` agent) |
| PR Description | `pr` | `generate_pr` | `coder-workflow:docs-engineer` |
| Changelog | `changelog` | `generate_changelog` | `coder-workflow:docs-engineer` |
| Release | `release` | `create_release` | `coder-workflow:devops-engineer` |
| Secrets Scan | `secrets` | `scan_secrets` | `coder-workflow:secret-scanner` |
| ADR | `adr` | `adr_new/list/get/graph` | `coder-workflow:docs-engineer` |
| Vuln Scan | `vuln-scan` | `scan_vulnerabilities` | `coder-workflow:vulnerability-scanner` |
| SBOM | `sbom` | `generate_sbom` | `coder-workflow:vulnerability-scanner` |
| Codebase QA | `qa` | `answer_question` | `coder-workflow:codebase-qa-agent` |
| Onboarding Docs | `onboarding-docs` | `generate_onboarding_docs` | `coder-workflow:docs-engineer` |
| Sprint Report | `sprint` | `sprint_report` | `coder-workflow:devops-engineer` |
| Team Metrics | `team-metrics` | `team_metrics` | `coder-workflow:devops-engineer` |
| Auto-Merge | `pr-check` | `pr_auto_merge` | `coder-workflow:devops-engineer` |
| Benchmark | `benchmark` | `record_benchmark` | `coder-workflow:devops-engineer` |
| API Contract | `api-contract` | `compare_api_specs` | `Explore` |
| Config Validation | `validate` | `validate_env_file` | `Explore` |
| License Check | `licenses` | `check_licenses` | `Explore` |
| Code Complexity | `complexity` | `analyze_complexity` | `Explore` |
| Log Analysis | `logs` | `analyze_logs` | `coder-workflow:debugging-engineer` |
| Coverage | `coverage` | `aggregate_coverage` | `coder-workflow:test-engineer` |
| Git Hooks | `hooks` | `scaffold_git_hooks` | `Explore` |
| TODO Tracker | `todos` | `scan_todos` | `coder-workflow:todo-checker` |
| Performance | `perf` | `analyze_bundle` | `Explore` |
| i18n Helper | `i18n` | `extract_i18n_strings` | `Explore` |
| DB Schema | `db-schema` | `parse_prisma_schema` | `coder-workflow:db-architect` |
| Doctor | `doctor` | `doctor` | `Explore` |
| Codebase Stats | `stats` | `codebase_stats` | `Explore` |
| UI Components | `ui` | — | `coder-workflow:ui-engineer` |
| Architecture Diagram | `diagram` | `export_graph` | `coder-workflow:diagram-engineer` |
| Quality Gate | `quality` | `quality_gate` | `coder-workflow:quality-guardian` |
| Consistency | `consistency` | — | `coder-workflow:quality-guardian` |
| Bug Hunt | `bughunt` | — | `coder-workflow:debugging-engineer` |
| Doc Generator | `docs-gen` | `generate_onboarding_docs` | `coder-workflow:docs-generator` |
| Rollback/Bisect | `timetravel` | — | `coder-workflow:rollback-engineer` |
| Secret Scanner | `secrets` | `scan_secrets` | `coder-workflow:secret-scanner` |
| Vulnerability | `vuln-scan` | `scan_vulnerabilities` | `coder-workflow:vulnerability-scanner` |
| Memory | `memory` | `store_memory` / `query_memory` | `coder-workflow:memory-librarian` |
| Refactoring | `refraktor` | — | `coder-workflow:refactoring-engineer` |
| Multi-Repo | `multirepo` | — | `coder-workflow:multi-repo-orchestrator` |
| Brainstorming | `brainstorming` | — | `brainstorming` skill |
| Sequential Think | `think` | `sequential_thinking` | `general-purpose` |

## Workflow Sequence

1. **Fast-Path**: Trivial (1-2 line fix) → `coder-workflow:code-implementer` directly. *The orchestrator never makes edits itself — even trivial fixes go through an agent.*
2. **Memory**: Complex/recurring → `coder-workflow:memory-librarian`
3. **Multi-Repo**: Cross-service → `coder-workflow:multi-repo-orchestrator`
4. **Brainstorming**: Underspecified → `brainstorming` skill
5. **Planning**: Full decomposition via `coder-workflow:workflow-planner` with parallel recon
6. **Swarm Dispatch (CRITICAL)**: After planning, orchestrator MUST spawn **1 subagent per task** using the `Agent` tool with `run_in_background: true`. Do NOT send multiple tasks to a single agent. If planner produced 10 tasks, spawn 10 subagents simultaneously. Each subagent receives exactly 1 task with clear FILE_MANIFEST boundaries.
7. **Synthesis & Conflict Resolution**: Wait for all subagents to complete. Identify overlaps/conflicts. Resolve them.
8. **Review**: `coder-workflow:code-reviewer` or `coder-workflow:architecture-auditor` as needed
9. **Bug Fix Phase**: Fix discovered bugs using Impact Radius Protocol

### Swarm Dispatch Rules

- **1 task = 1 subagent**. Never batch tasks into one agent.
- Isolated domains (different files/modules) → FULLY parallel, all spawned at once.
- Shared state (same file/config) → Still parallel, but agents MUST declare FILE_MANIFEST upfront so orchestrator can detect conflicts before merging.
- Use `Agent` tool (not `invoke_subagent`) for top-level swarm dispatch — `invoke_subagent` is for depth-2 calls inside a worker agent.
- After all complete, run synthesis: collect outputs, detect conflicts, resolve.

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
