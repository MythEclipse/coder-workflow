# CLAUDE.md

This file provides guidance to the AI CLI (claude.ai/code) when working with code in this repository.

## Project Overview

Coder Workflow is a the AI CLI plugin that orchestrates all coding work through aggressive task decomposition, skill-first routing, and persistent execution. It combines **coding workflow skills** (implement, audit, refactor, deploy) with **graph-first codebase understanding** via the CodeGraph MCP server. Ships skills, agents, commands, hooks, and an MCP server for disciplined coding workflows.

## Single Orchestrator Model

**`coder-orchestrator`** is the single entry point for ALL coding work — workflow routing (plan, implement, verify, fix bugs, run agents). Invoke it for every coding request.

Codebase exploration and MCP tool usage rules (graph-first, Explore codegraph-first, Context7-first, etc.) are enforced by **hooks** (`PreToolUse`/`PostToolUse`) — no need to repeat in skills or commands.

## Plugin Discovery

**This plugin installs to `~/.claude/skills/coder-workflow/`** (not `~/.claude/plugins/`). the AI CLI auto-discovers and loads plugins from `~/.claude/skills/<name>/` on every session start. No marketplace install needed.

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
|---------|----------------|---------|
| `/coder-workflow` | `coder-orchestrator` (skill) | Main routing brain for any task |
| `/plan` | `workflow-planner` | Task decomposition |
| `/audit` | `architecture-auditor` | Read-only architecture audit |
| `/refraktor` | `refactoring-engineer` | Modular MVC extraction |
| `/debug` | `debugging-engineer` | Root-cause analysis |
| `/test` | `test-engineer` | TDD and test scaffolding |
| `/deploy` | `devops-engineer` | Docker, CI/CD, Traefik setup |
| `/ui` | `ui-engineer` | React, Vue, CSS, Accessibility |
| `/db` | `db-architect` | SQL, indexing, schemas |
| `/docs` | `docs-engineer` | README, API specs, inline docs |
| `/review` | `code-reviewer` | Security & edge-case review |

## Agent Coordination

| Agent | Purpose |
|---|---|
| `workflow-planner` | Decompose requests into tracked tasks |
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

- **Always trigger `coder-orchestrator`** at session start for any coding task. It handles both workflow routing and codebase exploration (prioritize graph over grep, query over read).
- **Context Token Efficiency**: The main orchestrator must NEVER read large files, perform extensive searches, or edit code directly. ALWAYS dispatch subagents (`explorer`, `code-implementer`) to perform these actions to prevent massive token bloat in the main session context.
- **Tasks tracking is recommended**: While it is good practice to run `TaskCreate` early, initial codebase exploration using read-only tools is permitted before task creation.
- The coding orchestrator routes work through an agent sequence: the `workflow-planner` agent breaks the task into units.
- **Prefer sequential execution when modifying shared state** (e.g., config files, core modules) to avoid merge conflicts and race conditions. Use parallel subagents only for strictly independent tasks.
- **Every discovered bug MUST be tracked as a low-priority task** to be fixed at the end of the session, preventing feature starvation.
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

- `skills/` — interactive meta-skills (coder-orchestrator, brainstorming, dispatching-parallel-agents)
- `agents/` — specialized autonomous engineers (code-implementer, debugging-engineer, ui-engineer, db-architect, etc.)
- `commands/` — slash commands mapping to agents (/audit, /ui, /db, /deploy, etc.)
- `hooks/hooks.json` — auto-trigger for session start, git operations, safety guards
- `src/` — TypeScript source for CLI and MCP server
- `dist/` — bundled JavaScript artifacts
- `.mcp.json` — MCP server configuration
- `.claude-plugin/plugin.json` — plugin metadata for the AI CLI discovery

## Workflow Philosophy

1. **Tasks tracking** — It is recommended to use `TaskCreate` to organize work, but initial codebase exploration using read-only tools is permitted before task creation.
2. **Skills before guesses** — always route to appropriate skill
3. **Hooks encourage tool rules** — Prioritize MCP-before-grep, Explore codegraph-first, Context7-first. Fallback to raw tools gracefully if services fail.
4. **Track every discovered bug** — Track bugs as low-priority tasks and fix them at the end of the session, preventing feature starvation.
