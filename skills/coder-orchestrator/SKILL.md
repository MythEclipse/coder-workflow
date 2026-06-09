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

## DISPATCH NOW — No Deliberation

**CRITICAL: Do NOT think aloud before acting. Do NOT say "Actually...", "Wait...", "Hmm...", "Let me...", or any other internal reasoning. The moment this skill loads, you MUST:**

1. **Classify** the request in ≤1 second using the Routing Table below — pick the single best match.
2. **Print the Output Contract** (one line) immediately as your first visible output.
3. **Spawn the subagent(s)** — no preamble, no explanation, no deliberation.

The Output Contract is your FIRST output, not your last:

```
↳ coder-orchestrator → [agent-name]: [one-sentence goal]
```

If a request spans multiple categories, spawn one subagent per category in parallel — still no deliberation, just spawn all at once.

## Instruction Priority

1. **User's explicit instructions** (CLAUDE.md, direct requests) — highest
2. **Coder-workflow skills** — override system behavior where they conflict
3. **Default system prompt** — lowest

## Routing Table — Single Lookup, Immediate Dispatch

| Intent keywords | → Spawn this agent |
|---|---|
| implement / build / create / add / scaffold | `coder-workflow:code-implementer` |
| fix / debug / resolve / error / crash / bug | `coder-workflow:debugging-engineer` |
| refactor / reorganize / extract / move / layer | `coder-workflow:refactoring-engineer` |
| audit / review / check / analyze / inspect / cek / weakness / disconnect | `coder-workflow:architecture-auditor` |
| test / spec / coverage / TDD / unit / e2e | `coder-workflow:test-engineer` |
| deploy / docker / CI / CD / VPS / infra | `coder-workflow:devops-engineer` |
| explore / understand / how does / where is / explain | `Explore` agent |
| secrets / API key / token / hardcoded credential | `coder-workflow:secret-scanner` |
| vuln / CVE / SBOM / dependency risk | `coder-workflow:vulnerability-scanner` |
| QA / question / codebase question | `coder-workflow:codebase-qa-agent` |
| docs / README / contributing / architecture doc | `coder-workflow:docs-engineer` |
| ADR / PR description / changelog / release | `coder-workflow:docs-generator` |
| dead code / orphan / unused export | `coder-workflow:architecture-auditor` |
| UI / frontend / component / CSS / a11y | `coder-workflow:ui-engineer` |
| diagram / graph / architecture visualization | `coder-workflow:diagram-engineer` |
| DB / schema / migration / prisma / SQL | `coder-workflow:db-architect` |
| quality / smell / consistency / lint | `coder-workflow:quality-guardian` |
| memory / store / recall | `coder-workflow:memory-librarian` |
| rollback / bisect / timetravel / revert | `coder-workflow:rollback-engineer` |
| multi-repo / cross-service / microservice | `coder-workflow:multi-repo-orchestrator` |
| brainstorm / ideas / design / spec / unclear request | `brainstorming` skill |
| think / sequential / reason / plan complex | `coder-workflow:workflow-planner` |
| todo / FIXME / HACK / tech debt | `coder-workflow:todo-checker` |
| sprint / metrics / benchmark / ops | `coder-workflow:devops-engineer` |

**Ambiguous request?** Default to `coder-workflow:architecture-auditor` + `coder-workflow:codebase-qa-agent` in parallel. Still no deliberation.

## Headroom Feature-Agent Mapping

| Feature | CLI command | MCP tool | Best Agent |
|---|---|---|---|
| Dead Code | `dead-code` | `find_dead_code` | `coder-workflow:architecture-auditor` |
| Semantic Search | `semantic-search` | `semantic_search` | `Explore` |
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
| Architecture Diagram | `diagram` | `export_graph` | `coder-workflow:diagram-engineer` |
| Quality Gate | `quality` | `quality_gate` | `coder-workflow:quality-guardian` |
| Consistency | `consistency` | — | `coder-workflow:quality-guardian` |
| Bug Hunt | `bughunt` | — | `coder-workflow:debugging-engineer` |
| Doc Generator | `docs-gen` | `generate_onboarding_docs` | `coder-workflow:docs-generator` |
| Rollback/Bisect | `timetravel` | — | `coder-workflow:rollback-engineer` |
| Memory | `memory` | `store_memory` / `query_memory` | `coder-workflow:memory-librarian` |
| Refactoring | `refraktor` | — | `coder-workflow:refactoring-engineer` |
| Multi-Repo | `multirepo` | — | `coder-workflow:multi-repo-orchestrator` |

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

## Extended References

- **Core protocols** (crash recovery, impact radius, wisdom/failure handling): `references/core-protocols.md`
- **Orchestration guide** (agent templates, research protocol, task granularity): `references/orchestration-guide.md`

