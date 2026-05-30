# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Coder Workflow is a Claude Code plugin that orchestrates all coding work through aggressive task decomposition, skill-first routing, and persistent execution. It ships skills, agents, commands, and hooks for disciplined coding workflows.

## Dual-Orchestrator Model

Two orchestrators work together — they are complementary, not conflicting:

| Orchestrator | Source | Purpose |
|---|---|---|
| **`coder-orchestrator`** | coder-workflow | WORKFLOW GUIDE — how to plan, implement, verify, fix bugs, run agents |
| **`codegraph-orchestrator`** | codegraph-mapper | SEARCH GUIDE — how to explore codebase efficiently using MCP tools |

**Always load both.** `coder-orchestrator` is the main entry point for any coding request. It ALWAYS invokes `codegraph-orchestrator` immediately after for efficient codebase exploration (graph before grep, query before read, analyze before edit).

**BANNED: The built-in `Explore` agent.** ALL codebase exploration MUST use codegraph MCP tools via `codegraph-orchestrator`. `mcp__codegraph__query_graph` for definitions/references/callers. `mcp__codegraph__search_code` for text search. `mcp__codegraph__analyze_impact` for impact analysis. `mcp__codegraph__read_file` for file content. Never dispatch an Explore agent when codegraph MCP tools can answer.

## Orchestrator Usage (Required)

- **Always trigger `coder-orchestrator`** at session start for any coding task — features, bugs, refactors, reviews, deployments.
- **Always invoke `codegraph-orchestrator`** immediately after — provides efficient search/exploration patterns via MCP tools.
- The coding orchestrator routes work through a fixed agent sequence: `workflow-planner` → `architecture-auditor` → `code-implementer` → `architecture-auditor` (post-verify).
- Every coding session MUST invoke ALL sub-agents. No exceptions.
- Every discovered bug MUST be tracked and fixed — never skip as "not related to my changes."
- Use skills and MCP tools before guessing. Use context7 MCP for framework docs. Use codegraph MCP for code search.

## Skill Routing

| Request | Skill |
|---------|-------|
| Implement feature, fix bug, write tests | `coder` |
| Audit architecture, layer violations | `auditor` |
| Refactor to Modular MVC + Service + Repository | `refraktor` |
| Setup Docker, CI/CD, VPS deploy, Traefik | `deploy-docker` |
| Orchestrate any coding work | `coder-orchestrator` |

## Agent Coordination

- `workflow-planner`: Decompose requests into many small tracked tasks (10+ minimum)
- `architecture-auditor`: Read-only architecture and layer violation audit
- `code-implementer`: Scoped implementation after plan approval

## Installation

```bash
# Global install (available in all projects)
./install.sh

# Project-scoped install
./install.sh --project

# Symlink instead of copy
./install.sh --link
```

## Development commands

```bash
# Verify plugin structure
ls skills/ agents/ commands/ hooks/

# Test install
./install.sh --project --link
```

## Plugin Surface

- `skills/` — orchestrator, coder, auditor, refraktor, deploy-docker workflows
- `agents/` — workflow-planner, architecture-auditor, code-implementer subagents
- `commands/` — slash commands for orchestrator trigger, audit, and planning
- `hooks/hooks.json` — auto-trigger for skill routing after file changes
- `.claude-plugin/plugin.json` — plugin metadata for Claude Code

## Workflow Philosophy

1. **Tasks before tools** — every request decomposed into tracked tasks
2. **Skills before guesses** — always route to appropriate skill
3. **MCP before grep** — use codegraph/context7 MCP tools first
4. **Context7 before assumptions** — never guess API behavior
5. **Never give up** — decompose, research, ask, try different angles
6. **Fix every discovered bug** — no exceptions, no "not related to my changes"
