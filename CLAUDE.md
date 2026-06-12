# CLAUDE.md

This file provides guidance to the AI CLI (claude.ai/code) when working with code in this repository.

## Project Overview

Coder Workflow is a the AI CLI plugin that orchestrates all coding work through aggressive task decomposition, skill-first routing, and persistent execution. It combines **coding workflow skills** (implement, audit, refactor, deploy) with **graph-first codebase understanding** via the CodeGraph MCP server. Ships skills, agents, commands, hooks, and an MCP server for disciplined coding workflows.

## Single Orchestrator Model

**`coder-orchestrator`** is the single entry point for ALL coding work — workflow routing (plan, implement, verify, fix bugs, run agents). Invoke it for every coding request.
**CRITICAL FOR CHEAP MODELS**: If the user says "trigger coder:workflow" or similar, you MUST immediately invoke the `coder-orchestrator` skill/agent or call the corresponding tool. Do NOT just acknowledge the request.

Codebase exploration and MCP tool usage rules (graph-first, CodeGraph-first via `explore-codebase`, Context7-first, etc.) are enforced by **hooks** (`PreToolUse`/`PostToolUse`) — no need to repeat in skills or commands.

## Plugin Discovery

**This plugin installs to `~/.claude/skills/coder-workflow/`** (not `~/.claude/plugins/`). The AI CLI auto-discovers and loads plugins from `~/.claude/skills/<name>/` on every session start. No marketplace install needed.

```bash
./install.sh          # installs to ~/.claude/skills/coder-workflow/ (builds + global CLI + MCP)
./install.sh --link   # symlinks for development
./install.sh --project # installs to ./.claude/ for this project only
./install.sh --mcp-only # install only the MCP server
```

After install: restart the AI CLI or run `/reload-plugins`.
When loaded as a plugin, skills are namespaced: `/coder-workflow:coder`, `/coder-workflow:auditor`, etc.

## Slash Commands (Fast Triggers)

| Command | Triggers Agent | Purpose |
|---|---|---|
| `/coder-workflow` | `coder-orchestrator` (skill) | Main routing brain for any task |
| `/plan` | `built-in planner` | Task decomposition |
| `/audit` | `architecture-auditor` | Read-only architecture audit |
| `/refraktor` | `refactoring-engineer` | Modular MVC extraction |
| `/debug` | `debugging-engineer` | Root-cause analysis |
| `/test` | `test-engineer` | TDD and test scaffolding |
| `/deploy` | `devops-engineer` | Docker, CI/CD, Traefik setup |
| `/ui` | `ui-engineer` | React, Vue, CSS, Accessibility |
| `/db` | `db-architect` | SQL, indexing, schemas |
| `/docs` | `docs-engineer` | README, API specs, inline docs |
| `/review` | `code-reviewer` | Security & edge-case review |
| `/deadcode` | `architecture-auditor` | Deteksi unused exports & dead code |
| `/secrets` | `secret-scanner` | Scan API keys, tokens, passwords |
| `/adr` | `docs-generator` | Architecture Decision Records |
| `/pr` | `docs-generator` | PR description + changelog + release |
| `/vuln` | `vulnerability-scanner` | CVE scan & SBOM generation |
| `/qa` | `codebase-qa` | Ask anything about the codebase |
| `/ops` | `devops-engineer` | Sprint, metrics, benchmark, auto-merge |
| `/semantic-search` | `coder-workflow:explore-codebase` | Search code by meaning |
| `/licenses` | `coder-workflow:explore-codebase` | Scan dependency licenses for compliance |
| `/complexity` | `coder-workflow:explore-codebase` | Cyclomatic complexity analysis |
| `/logs` | `coder-workflow:debugging-engineer` | Parse and analyze JSONL log files |
| `/coverage` | `test-engineer` | Aggregate coverage reports (jest, vitest) |
| `/hooks` | `coder-workflow:explore-codebase` | Scaffold git hooks with validation |
| `/todos` | `todo-checker` | TODO/FIXME tracking with author aging |
| `/perf` | `coder-workflow:explore-codebase` | Bundle size analysis and performance audit |
| `/i18n` | `coder-workflow:explore-codebase` | Extract i18n strings and check translations |
| `/db-schema` | `db-architect` | Prisma/TypeORM schema diff and analysis |
| `/doctor` | `coder-workflow:explore-codebase` | Dev environment and project health check |
| `/stats` | `coder-workflow:explore-codebase` | Codebase statistics (LOC, languages, trends) |
| `/api-contract` | `coder-workflow:explore-codebase` | Compare OpenAPI specs for breaking changes |
| `/think` | Custom MCP | Structured sequential reasoning with branching & revision |

## Agent Coordination

| Agent | Purpose |
|---|---|
| `workflow-planner` (skill) | Decompose requests into tracked tasks |
| `architecture-auditor` | Read-only architecture and layer violation audit |
| `code-implementer` | Scoped implementation after plan approval |
| `test-engineer` | Test generation, coverage gap detection |
| `refactoring-engineer` | Structural codebase transformations |
| `debugging-engineer` | Systematic error tracing and resolution |
| `devops-engineer` | Infrastructure as Code, CI/CD |
| `docs-engineer` | Documentation synchronization |
| `code-reviewer` | Security audits and peer reviews |
| `ui-engineer` | Frontend UI components and state |
| `db-architect` | Database schemas and migrations |
| `todo-checker` | Dummy code and TODO scanner |
| `codebase-qa` | Answer codebase questions (RAG over docs + code) |
| `secret-scanner` | Detect hardcoded secrets, API keys, tokens |
| `vulnerability-scanner` | CVE scan & SBOM generation |
| `docs-generator` | Generate CONTRIBUTING, ADR, PR, changelog |
| **`explore-codebase`** | **CodeGraph-first codebase exploration (replaces built-in `Explore`)** |

## Orchestrator Usage (Required)

- **Always trigger `coder-orchestrator`** at session start for any coding task.
- **Context Token Efficiency**: The main orchestrator must NEVER read large files, perform extensive searches, or edit code directly. ALWAYS dispatch subagents.
- **Tasks tracking**: Use TaskCreate to track all work. Initial read-only exploration permitted before task creation.
- **Prefer sequential execution** when modifying shared state (config, core modules). Use parallel subagents only for strictly independent tasks.
- **Track every discovered bug** as low-priority tasks to fix at end of session.
- **Use skills and MCP tools before guessing** — Context7 for framework docs, CodeGraph for code search.
- **No Excuses for Pre-existing Issues**: Never ignore warnings/errors. Fix underlying logic.

## Plugin Surface

- `skills/` — interactive meta-skills (orchestrator, brainstorming, workflow planner, quality guardian)
- `agents/` — specialized autonomous engineers (code-implementer, debugging-engineer, etc.)
- `commands/` — slash commands mapping to agents
- `hooks/hooks.json` — auto-trigger for session start, git operations, safety guards
- `src/` — TypeScript source for CLI and MCP server
- `docs/` — reference documentation (headroom, plugin reference, design taxonomies)
- `.mcp.json` — MCP server configuration (CodeGraph + Context7)
- `.claude-plugin/plugin.json` — plugin metadata

## Docs Index

| Document | Contents |
|---|---|
| `docs/headroom.md` | CCR compression, CacheAligner, Learn failure analysis, Cross-Agent Memory |
| `docs/plugin-reference.md` | Official plugin/skills/subagents/hooks/MCP reference |
| `docs/mcp-server.md` | CodeGraph MCP tools and configuration |
| `docs/development.md` | Build/test/lint commands |
| `docs/workflow-philosophy.md` | Workflow principles and philosophy |
| `docs/design/code-quality-taxonomy.md` | Four Pillars, Design Patterns, Metrics, Testability |
| `docs/design/architecture-taxonomy.md` | Coupling Metrics, Graph Theory, Architectural Styles |
| `docs/design/refactoring-taxonomy.md` | Code Smells, Refactoring Techniques, Architectural Patterns |
| `docs/design/debugging-taxonomy.md` | Bug Taxonomy, RCA Methods, Patterns/Anti-patterns |
| `docs/design/testing-taxonomy.md` | Core Taxonomy, Techniques, Test Doubles, FIRST |
| `docs/design/tool-guides.md` | CodeGraph MCP tool usage reference for all agents |
