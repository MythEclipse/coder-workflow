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

See `commands/` directory (40+ commands) or `docs/plugin-reference.md` for full command table. Key commands: `/coder-workflow` (orchestrator), `/audit` (architecture), `/plan` (task decomposition), `/refraktor` (refactor), `/debug` (debugging), `/test` (TDD), `/deploy` (infra).

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
- **EXTERNAL RESEARCH FIRST**: For any new feature, library, or API (e.g. Claude Code features, third-party libraries), you MUST search external sources FIRST (using Context7 MCP, searching the web, or reading official docs). DO NOT assume its behavior or search the codebase for examples of how it works until you have read the official external documentation. Do not guess.
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
