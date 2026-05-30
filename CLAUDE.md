# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Coder Workflow is a Claude Code plugin that orchestrates all coding work through aggressive task decomposition, skill-first routing, and persistent execution. It combines **coding workflow skills** (implement, audit, refactor, deploy) with **graph-first codebase understanding** via the CodeGraph MCP server. Ships skills, agents, commands, hooks, and an MCP server for disciplined coding workflows.

## Single Orchestrator Model

**`coder-orchestrator`** is the single entry point for ALL coding work — workflow routing (plan, implement, verify, fix bugs, run agents). Invoke it for every coding request.

Codebase exploration and MCP tool usage rules (graph-first, Explore ban, Context7-first, etc.) are enforced by **hooks** (`PreToolUse`/`PostToolUse`) — no need to repeat in skills or commands.

## Plugin Discovery

**This plugin installs to `~/.claude/skills/coder-workflow/`** (not `~/.claude/plugins/`). Claude Code auto-discovers and loads plugins from `~/.claude/skills/<name>/` on every session start. No marketplace install needed.

```bash
./install.sh          # installs to ~/.claude/skills/coder-workflow/ (builds + global CLI + MCP)
./install.sh --link   # symlinks for development
./install.sh --project # installs to ./.claude/ for this project only
./install.sh --mcp-only # install only the MCP server
```

After install: restart Claude Code or run `/reload-plugins`.

When loaded as a plugin, skills are namespaced: `/coder-workflow:coder`, `/coder-workflow:auditor`, etc.

## Skill Routing

| Request | Skill |
|---------|-------|
| Implement feature, fix bug, write tests | `coder` |
| Audit architecture, layer violations | `auditor` |
| Refactor to Modular MVC + Service + Repository | `refraktor` |
| Setup Docker, CI/CD, VPS deploy, Traefik | `deploy-docker` |
| Orchestrate any coding work | `coder-orchestrator` |

## Agent Coordination

| Agent | Purpose |
|---|---|
| `workflow-planner` | Decompose requests into tracked tasks (right-sized: 1-3 for simple, 3-8 for features, 10+ for complex) |
| `architecture-auditor` | Read-only architecture and layer violation audit |
| `code-implementer` | Scoped implementation after plan approval (right-sized: simple=direct, complex=full SDD) |
| `test-engineer` | Test generation, coverage gap detection, test scaffolding |

## Hooks (Auto-Loaded)

Hooks are defined in `hooks/hooks.json` and companion scripts in `hooks/scripts/`. Auto-merged at runtime:

| Hook Event | Matcher | Purpose |
|---|---|---|
| `SessionStart` | `startup` | Banner with graph status + CLI check + async auto-scan if no DB |
| `SessionStart` | `resume` | Graph age check + task-state reminder |
| `SessionStart` | `compact` | Post-compact re-orientation notice |
| `SessionStart` | `clear` | Clear session log + clean-slate notice |
| `UserPromptSubmit` | — | Async: log prompt preview to `/tmp/cw-session.log` |
| `PreToolUse` | `Bash(rm *)` | **Safety guard**: block `rm -rf` targeting root/home/glob |
| `PreToolUse` | `Bash(git push *)` | **Safety guard**: block force-push to main/master; warn on feature branches |
| `PreToolUse` | `Bash(git reset *)` | Warn before `--hard` reset or `clean -f` |
| `PreToolUse` | `Bash(psql/mysql/sqlite3)` | Warn on destructive SQL (DROP/TRUNCATE) |
| `PreToolUse` | `Write/Edit(.env*)` | Warn if env file is not gitignored |
| `PostToolUse` | `Write/Edit/MultiEdit/NotebookEdit` | Bug tracking reminder + log write + async graph update |
| `PostToolUse` | `Bash(npm/yarn/bun install)` | Package install notice |
| `PostToolUse` | `Bash(git commit)` | Async: log commit |
| `PostToolUse` | `Bash(npm test/lint/typecheck)` | Async: log test/lint run |
| `PostToolUse` | `mcp__codegraph__.*` | Async: log all graph MCP operations |
| `PostToolUseFailure` | `*` | Async: log tool failure with error detail |
| `PostToolBatch` | — | Async: log resolved batch count |
| `Stop` | — | Full verification checklist + async graph update |
| `StopFailure` | `rate_limit` | Rate limit advice + retry guidance |
| `StopFailure` | `max_output_tokens` | Token limit guidance |
| `StopFailure` | `server_error/unknown/…` | Async: log error + resume instructions |
| `FileChanged` | `package.json/lock files` | Install reminder |
| `FileChanged` | `.env*` | Secret exposure warning |
| `FileChanged` | `CLAUDE.md` | Instructions updated notice |
| `FileChanged` | `hooks.json` | Hook config updated notice |
| `FileChanged` | `tsconfig.json/biome.json` | Rebuild reminder |
| `FileChanged` | `.mcp.json` | MCP restart reminder |
| `CwdChanged` | — | Log new directory + CodeGraph availability check |
| `PostCompact` | `*` | Re-orientation notice after compaction |
| `SubagentStart` | `*` | Async: log agent spawn |
| `SubagentStop` | `*` | Async: log agent completion |
| `TaskCreated` | — | Echo task name + async log |
| `TaskCompleted` | — | Echo task name + async log |
| `InstructionsLoaded` | `session_start/nested/include` | Async: log which CLAUDE.md files loaded |
| `ConfigChange` | `project_settings/user_settings` | Async: log config source + notice |
| `SessionEnd` | `*` | Print session summary (tasks/commits/agents/failures) + cleanup log |

## Orchestrator Usage (Required)

- **Always trigger `coder-orchestrator`** at session start for any coding task — features, bugs, refactors, reviews, deployments. It handles both workflow routing AND codebase exploration (graph before grep, query before read).
- **Always run `TaskCreate` + `TaskUpdate` first**: Before using any search or file-reading tools for initial exploration or planning, you MUST first run `TaskCreate` to create an initial task (e.g., 'Explore codebase and plan implementation') and mark it `in_progress` via `TaskUpdate`. This prevents task tool usage warnings.
- The coding orchestrator routes work through a fixed agent sequence: `workflow-planner` → `architecture-auditor` → `code-implementer` → `architecture-auditor` (post-verify).
- Every coding session uses right-sized agents: simple tasks execute directly, complex tasks use full agent chain. Scale to complexity, not ceremony.
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

- `skills/` — workflow skills (coder, auditor, coder-orchestrator, refraktor, deploy-docker)
- `agents/` — workflow-planner, architecture-auditor, code-implementer, test-engineer
- `commands/` — slash commands for orchestrator, audit, plan, refraktor
- `hooks/hooks.json` — auto-trigger for session start, file changes, session end
- `src/` — TypeScript source for CLI and MCP server
- `dist/` — bundled JavaScript artifacts
- `.mcp.json` — MCP server configuration
- `.claude-plugin/plugin.json` — plugin metadata for Claude Code discovery

## Workflow Philosophy

1. **Tasks before tools** — Before running ANY other tools (such as Grep, ViewFile, run_command, or CodeGraph MCP tools) at the start of a session or when receiving a new task, you MUST first run `TaskCreate` to initialize workflow tracking. Create an initial task (e.g., 'Explore and research codebase' or 'Plan implementation and explore files') and set it to `in_progress` immediately using `TaskUpdate`. This prevents warnings about task tools not being used.
2. **Skills before guesses** — always route to appropriate skill
3. **Hooks enforce tool rules** — MCP-before-grep, Explore ban, Context7-first, and graph-first rules are enforced by PreToolUse/PostToolUse hooks automatically
4. **Fix every discovered bug** — no exceptions, no "not related to my changes"
