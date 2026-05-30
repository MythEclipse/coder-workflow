# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Coder Workflow is a Claude Code plugin that orchestrates all coding work through aggressive task decomposition, skill-first routing, and persistent execution. It combines **coding workflow skills** (implement, audit, refactor, deploy) with **graph-first codebase understanding** via the CodeGraph MCP server. Ships skills, agents, commands, hooks, and an MCP server for disciplined coding workflows.

## Dual-Orchestrator Model

Two orchestrators work together — they are complementary, not conflicting:

| Orchestrator | Purpose | When |
|---|---|---|
| **`coder-orchestrator`** | WORKFLOW GUIDE — how to plan, implement, verify, fix bugs, run agents | ALWAYS triggers for any coding request |
| **`codegraph-orchestrator`** | SEARCH GUIDE — how to explore codebase efficiently using MCP tools | ALWAYS loaded by coder-orchestrator for code search/exploration |

**Always load both.** `coder-orchestrator` is the main entry point for any coding request. It ALWAYS invokes `codegraph-orchestrator` immediately after for efficient codebase exploration (graph before grep, query before read, analyze before edit).

**BANNED: The built-in `Explore` agent.** ALL codebase exploration MUST use codegraph MCP tools via `codegraph-orchestrator`. `mcp__codegraph__query_graph` for definitions/references/callers. `mcp__codegraph__search_code` for text search. `mcp__codegraph__analyze_impact` for impact analysis. `mcp__codegraph__read_file` for file content. Never dispatch an Explore agent when codegraph MCP tools can answer.

## Plugin Discovery

**This plugin installs to `~/.claude/skills/coder-workflow/`** (not `~/.claude/plugins/`). Claude Code auto-discovers and loads plugins from `~/.claude/skills/<name>/` on every session start. No marketplace install needed.

```bash
./install.sh          # installs to ~/.claude/skills/coder-workflow/ (builds + global CLI + MCP)
./install.sh --link   # symlinks for development
./install.sh --project # installs to ./.claude/ for this project only
./install.sh --mcp-only # install only the MCP server
```

After install: restart Claude Code or run `/reload-plugins`.

When loaded as a plugin, skills are namespaced: `/coder-workflow:coder`, `/coder-workflow:scan-codegraph`, etc.

## Skill Routing

### Workflow Skills
| Request | Skill |
|---------|-------|
| Implement feature, fix bug, write tests | `coder` |
| Audit architecture, layer violations | `auditor` |
| Refactor to Modular MVC + Service + Repository | `refraktor` |
| Setup Docker, CI/CD, VPS deploy, Traefik | `deploy-docker` |
| Orchestrate any coding work | `coder-orchestrator` |

### CodeGraph Skills
| Request | Skill |
|---------|-------|
| Build/refresh code graph | `scan-codegraph` |
| Find definitions, references, callers | `query-codegraph` |
| Architecture analysis, impact, risk, cycles | `analyze-codegraph` |
| Route codebase work through CodeGraph | `codegraph-orchestrator` |
| Parallel file reads / searches | `batch-codegraph` |
| Export Mermaid, DOT, JSON, HTML | `export-codegraph` |
| Interactive graph visualization | `open-codegraph-ui` |
| Graph-first refactor to MVC | `modular-mvc-refactor` (→ delegates to `refraktor`) |

## Agent Coordination

| Agent | Purpose |
|---|---|
| `workflow-planner` | Decompose requests into many small tracked tasks (10+ minimum) |
| `architecture-auditor` | Read-only architecture and layer violation audit |
| `code-implementer` | Scoped implementation after plan approval |
| `codegraph-builder` | Build/refresh code graph, handle scan errors |
| `codegraph-analyst` | Analyze graph for patterns, cycles, risk, hotspots |

## Hooks (Auto-Loaded)

Hooks are defined in `hooks/hooks.json` and auto-merged with all other plugin hooks at runtime:

| Hook Event | Purpose |
|---|---|
| `SessionStart` | Invoke orchestrator reminder + auto-scan graph if missing |
| `PostToolUse` (Write/Edit/NotebookEdit) | Bug tracking reminder + async graph update |
| `Stop` | Verify all tasks completed + async graph update |

## Orchestrator Usage (Required)

- **Always trigger `coder-orchestrator`** at session start for any coding task — features, bugs, refactors, reviews, deployments.
- **Always invoke `codegraph-orchestrator`** immediately after — provides efficient search/exploration patterns via MCP tools.
- The coding orchestrator routes work through a fixed agent sequence: `workflow-planner` → `architecture-auditor` → `code-implementer` → `architecture-auditor` (post-verify).
- Every coding session MUST invoke ALL sub-agents. No exceptions.
- Every discovered bug MUST be tracked and fixed — never skip as "not related to my changes."
- Use skills and MCP tools before guessing. Use context7 MCP for framework docs. Use codegraph MCP for code search.

## MCP Server

The plugin includes a CodeGraph MCP server accessible via `coder-workflow mcp`. Configure via `.mcp.json` for graph-first code intelligence. The MCP server exposes tools: `scan_codebase`, `query_graph`, `analyze_impact`, `analyze_quality`, `search_code`, `find_cycles`, `find_orphans`, `summarize_architecture`, `export_graph`, `quality_gate`, `read_file`, `list_directory_tree`.

## Development Commands

```bash
# Install dependencies + build + global CLI + MCP config
./install.sh

# Build TypeScript
npm run build

# Typecheck
npm run typecheck

# Run tests
npm run test

# Start MCP server directly
npm run start:mcp

# Scan codebase
npm run scan

# Open graph UI
npm run ui

# Lint / format
npm run lint
npm run check

# Verify plugin structure
ls skills/ agents/ commands/ hooks/ dist/ src/

# Test install to current project
./install.sh --project --link

# Test with --plugin-dir (no install needed)
claude --plugin-dir /mnt/code/djnaidwhbwda/coder-workflow
```

## Plugin Surface

- `skills/` — workflow (coder, auditor, coder-orchestrator, refraktor, deploy-docker) + codegraph (scan, query, analyze, codegraph-orchestrator, batch, export, open-ui, modular-mvc-refactor)
- `agents/` — workflow-planner, architecture-auditor, code-implementer, codegraph-builder, codegraph-analyst
- `commands/` — slash commands for orchestrator, audit, plan, setup-codegraph, refraktor
- `hooks/hooks.json` — auto-trigger for session start, file changes, session end
- `src/` — TypeScript source for CLI and MCP server
- `dist/` — bundled JavaScript artifacts
- `.mcp.json` — MCP server configuration
- `.claude-plugin/plugin.json` — plugin metadata for Claude Code discovery

## Workflow Philosophy

1. **Tasks before tools** — every request decomposed into tracked tasks
2. **Skills before guesses** — always route to appropriate skill
3. **MCP before grep** — use codegraph/context7 MCP tools first
4. **Context7 before assumptions** — never guess API behavior
5. **Graph before grep** — scan codebase graph before broad file search
6. **Never give up** — decompose, research, ask, try different angles
7. **Fix every discovered bug** — no exceptions, no "not related to my changes"
