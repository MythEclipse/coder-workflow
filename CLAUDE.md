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
| `/deadcode` | `architecture-auditor` | Deteksi unused exports & dead code |
| `/secrets` | `secret-scanner` | Scan API keys, tokens, passwords |
| `/adr` | `docs-generator` | Architecture Decision Records |
| `/pr` | `docs-generator` | PR description + changelog + release |
| `/vuln` | `vulnerability-scanner` | CVE scan & SBOM generation |
| `/qa` | `codebase-qa-agent` | Tanya apa aja tentang codebase |
| `/ops` | `devops-engineer` | Sprint, metrics, benchmark, auto-merge |
| `/semantic-search` | `Explore` | Search code by meaning |
| `/licenses` | `Explore` | Scan dependency licenses for compliance |
| `/complexity` | `Explore` | Cyclomatic complexity analysis |
| `/logs` | `Explore` | Parse and analyze JSONL log files |
| `/coverage` | `test-engineer` | Aggregate coverage reports (jest, vitest) |
| `/hooks` | `Explore` | Scaffold git hooks with validation |
| `/todos` | `todo-checker` | TODO/FIXME tracking with author aging |
| `/perf` | `Explore` | Bundle size analysis and performance audit |
| `/i18n` | `Explore` | Extract i18n strings and check translations |
| `/db-schema` | `db-architect` | Prisma/TypeORM schema diff and analysis |
| `/doctor` | `Explore` | Dev environment and project health check |
| `/stats` | `Explore` | Codebase statistics (LOC, languages, trends) |
| `/api-contract` | `Explore` | Compare OpenAPI specs for breaking changes |

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
| `codebase-qa-agent` 🆕 | Answer codebase questions (RAG over docs + code) |
| `secret-scanner` 🆕 | Detect hardcoded secrets, API keys, tokens |
| `vulnerability-scanner` 🆕 | CVE scan & SBOM generation |
| `docs-generator` 🆕 | Generate CONTRIBUTING, ADR, PR, changelog |

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

## Headroom Features (Context Optimization)

This plugin is now equipped with Headroom-inspired context compression and memory features.

### 1. CCR — Reversible Context Compression
Compress tool outputs, code, JSON, and prose by 60-95% before sending to LLM. Originals stored locally in `.claude/ccr/` and retrievable on demand.

**MCP Tools:** `compress_content`, `decompress_content`, `ccr_stats`, `clean_ccr`
**CLI:** `coder-workflow compress [--json|--code|--prose]`, `coder-workflow decompress <ccr-id>`  
**Aliases:** `ccr-stats`, `ccr-clean`

Architecture:
- **SmartCrusher** — JSON compressor: schema extraction + key shortening for arrays of objects, nested objects
- **CodeCompressor** — AST-aware code compression: strip comments, collapse blanks, truncate long identifiers
- **Prose Compressor** — Log/tool output: collapse to head+tail, truncate with line count

### 2. CacheAligner — KV Cache Optimization
Standardize prefixes of prompts and system messages so that Anthropic/OpenAI provider-side KV caching hits more frequently.

**MCP Tools:** `align_cache`, `cache_alignment_stats`
**CLI:** `coder-workflow align-cache [--type system|agent|skill] [--sub-type <name>]`

Stable prefixes registered for all agent types (implementer, auditor, debugger, reviewer, tester, ui, db, deploy, docs) and skills (orchestrator, plan, brainstorm).

### 3. Learn — Self-Improving Failure Analysis
Every tool failure and stop failure is logged via hooks. On demand, the system analyzes failure patterns and auto-generates corrections written to `.claude/learn/memory/`.

**MCP Tools:** `analyze_failures`, `learn_report`, `log_failure`, `resolve_failure`, `match_correction`
**CLI:** `coder-workflow learn-analyze [--apply]`, `learn-report`, `learn-log`, `learn-resolve`, `learn-match`

Hook integration:
- `StopFailure` — auto-logs rate_limit, max_output_tokens, server errors via `learn-log`
- `PostToolUseFailure` — auto-logs all tool failures with tool name + error

### 4. Cross-Agent Memory — Multi-Platform Memory Store
Platform-agnostic memory format readable by Claude, Codex, Gemini, and Cursor. Entries stored in `.claude/cross-agent-memory/` with YAML frontmatter and agent provenance tracking.

**MCP Tools:** `store_memory`, `query_memory`, `memory_stats`, `export_memory_markdown`, `sync_memory_platform`, `supported_platforms`
**CLI:** `coder-workflow memory-store [--name <slug> --description <text> --content <text> --agent <name>]`, `memory-query`, `memory-stats`, `memory-export`, `memory-sync`, `memory-platforms`

Features:
- Auto-deduplication by content hash
- Platform-agnostic Markdown export for non-Claude agents
- YAML export for CI/CD pipelines
- Cross-platform sync via directory-based import

### Quick Start: Headroom
```bash
# Compress any content
echo '{"data": "very long json ..."}' | coder-workflow compress --json

# Decompress a CCR entry
coder-workflow decompress a1b2c3d4e5f6-prose

# Analyze failures and apply corrections
coder-workflow learn-analyze --apply

# Store a cross-agent memory
coder-workflow memory-store --name "bug-fix-pattern" --description "How to fix X" --content "Fix steps..." --agent "alice"

# Align content for cache (pipe through before sending to LLM)
echo "Your agent prompt here" | coder-workflow align-cache --type agent --sub-type implementer
```

## Workflow Philosophy

1. **Tasks tracking** — It is recommended to use `TaskCreate` to organize work, but initial codebase exploration using read-only tools is permitted before task creation.
2. **Skills before guesses** — always route to appropriate skill
3. **Hooks encourage tool rules** — Prioritize MCP-before-grep, Explore codegraph-first, Context7-first. Fallback to raw tools gracefully if services fail.
4. **Track every discovered bug** — Track bugs as low-priority tasks and fix them at the end of the session, preventing feature starvation.

## Official Documentation Reference (crawled 2026-06-04)

Sumber dokumentasi resmi untuk plugin Claude Code. Gunakan referensi ini saat mengubah atau mengembangkan plugin ini.

### Plugin System Overview

Source: https://code.claude.com/docs/en/plugins

**Plugin vs Standalone:**
| Approach | Skill Names | Best For |
|---|---|---|
| Standalone (`.claude/` dir) | `/hello` | Personal workflows, project-specific, quick experiments |
| Plugin (self-contained dir) | `/plugin-name:hello` | Sharing, distribution, reusable across projects |

**Plugin Directory Structure:**
| Directory | Location | Purpose |
|---|---|---|
| `.claude-plugin/` | Plugin root | `plugin.json` manifest |
| `skills/` | Plugin root | Skills as `<name>/SKILL.md` dirs |
| `commands/` | Plugin root | Skills as flat `.md` files |
| `agents/` | Plugin root | Custom agent definitions |
| `hooks/` | Plugin root | `hooks.json` event handlers |
| `.mcp.json` | Plugin root | MCP server configs |
| `.lsp.json` | Plugin root | LSP server configs |
| `monitors/` | Plugin root | Background monitor configs |
| `bin/` | Plugin root | Executables added to `PATH` |
| `settings.json` | Plugin root | Default settings applied when enabled |

**Key Rules:**
- WARNING: `.claude-plugin/` only contains `plugin.json`. All other dirs (`skills/`, `agents/`, `hooks/`, `commands/`) go at plugin root, NOT inside `.claude-plugin/`.
- Plugin skills are namespaced: `/plugin-name:skill-name`
- Test with `claude --plugin-dir ./path/to/plugin`
- Run `/reload-plugins` after changes (no restart needed)
- Convert standalone `.claude/` to plugin: copy files, move hooks from `settings.json` to `hooks/hooks.json`

**Skills-Directory Plugin (used by this project):**
- Any folder under `~/.claude/skills/` or `.claude/skills/` with `.claude-plugin/plugin.json` loads as `<name>@skills-dir`
- Scaffold: `claude plugin init <name>` → creates `~/.claude/skills/<name>/`
- Project-scope: requires workspace trust dialog
- Disable: `claude plugin disable <name>@skills-dir`

### Plugin Manifest Schema (`plugin.json`)

Source: https://code.claude.com/docs/en/plugins-reference

```json
{
  "name": "plugin-name",           // Required. Unique identifier, kebab-case
  "displayName": "Plugin Name",    // Human-readable in /plugin UI
  "version": "1.2.0",             // Optional. If omitted, git SHA used
  "description": "...",
  "author": {"name": "...", "email": "...", "url": "..."},
  "homepage": "https://...",
  "repository": "https://...",
  "license": "MIT",
  "keywords": ["..."],
  "defaultEnabled": true,          // v2.1.154+. false = installed but disabled
  "skills": "./custom/skills/",    // Custom paths for components
  "commands": ["./cmd1.md"],
  "agents": ["./agents/reviewer.md"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "lspServers": "./.lsp.json",
  "userConfig": {
    "api_key": { "type": "string", "title": "API Key", "sensitive": true }
  },
  "dependencies": [{"name": "...", "version": "~1.0"}]
}
```

**Environment Variables for Plugin Paths:**
| Variable | Purpose | Example |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin installation dir | `"${CLAUDE_PLUGIN_ROOT}/scripts/format.sh"` |
| `${CLAUDE_PLUGIN_DATA}` | Persistent data dir (survives updates) | `"${CLAUDE_PLUGIN_DATA}/node_modules"` |
| `${CLAUDE_PROJECT_DIR}` | Project root | `"${CLAUDE_PROJECT_DIR}/.env"` |
| `${user_config.KEY}` | User-config value | `${user_config.api_key}` |

**Version Management:**
- Explicit `version` in `plugin.json`: users only get updates when you bump
- No version = git commit SHA: every commit = new version
- Tag releases: `claude plugin tag --push`

### Skills Reference

Source: https://code.claude.com/docs/en/skills

**SKILL.md Format:**
```yaml
---
description: What this skill does and when Claude should use it
disable-model-invocation: true   # Only user can invoke
user-invocable: false             # Only Claude can invoke
context: fork                     # Run in subagent
agent: Explore                    # Agent type when forked
allowed-tools: Read Grep Bash     # Pre-approved tools
disallowed-tools: Edit Write      # Blocked tools
model: sonnet                     # Model override
effort: high                      # Effort level
argument-hint: "[issue-number]"   # Autocomplete hint
arguments: [issue, branch]        # Named positional args
paths: "src/**/*.ts"              # Path activation patterns
shell: bash                       # Shell for !`cmd` blocks
hooks:                            # Scoped hooks (see Hooks section)
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./validate.sh"
---
```

**String Substitutions:**
| Variable | Description |
|---|---|
| `$ARGUMENTS` | All arguments passed to skill |
| `$ARGUMENTS[N]` / `$N` | Specific argument by 0-based index |
| `$name` | Named argument from `arguments` frontmatter |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_EFFORT}` | Current effort level |
| `${CLAUDE_SKILL_DIR}` | Skill's directory path |

**Dynamic Context Injection:**
- `` !`command` `` — runs shell command, replaces line with output (preprocessing, runs before Claude sees content)
- `` ```! `` — fenced block for multi-line commands
- Set `disableSkillShellExecution: true` in settings to disable

**context: fork Behavior:**
- Skill content becomes the subagent's prompt
- Uses agent type specified in `agent` field (default: `general-purpose`)
- Explore/Plan agents skip CLAUDE.md and git status for smaller context
- Subagent result returns to main conversation as summary

**Skill Content Lifecycle:**
- Rendered SKILL.md enters conversation as one message, stays for rest of session
- Auto-compaction carries forward most recent invocation (first 5000 tok)
- Combined budget of 25000 tok across re-attached skills
- Re-invoke after compaction to restore full content

**Skill Locations & Priority:**
| Location | Scope |
|---|---|
| Enterprise (managed) | Organization-wide, highest priority |
| Personal `~/.claude/skills/` | All your projects |
| Project `.claude/skills/` | This project only |
| Plugin `<plugin>/skills/` | Where plugin enabled, namespaced |

### Subagents Reference

Source: https://code.claude.com/docs/en/sub-agents

**Built-in Agents:**
| Agent | Model | Tools | Purpose |
|---|---|---|---|
| Explore | Haiku | Read-only | File discovery, code search |
| Plan | Inherits | Read-only | Codebase research for planning |
| General-purpose | Inherits | All tools | Complex multi-step tasks |

**Subagent Definition Format:**
```markdown
---
name: agent-name                   # Required. Unique identifier
description: What this agent does  # Required. Claude uses for delegation
tools: Read, Grep, Glob, Bash      # Allowlist (omit = inherit all)
disallowedTools: Write, Edit       # Denylist
model: sonnet                      # sonnet/opus/haiku/inherit/full-model-id
permissionMode: auto               # default/acceptEdits/auto/dontAsk/bypassPermissions/plan
maxTurns: 20                       # Max agentic turns
skills: [skill-name]               # Preload skills into context
memory: user                       # user/project/local — persistent memory
background: true                   # Always run as background task
effort: high                       # low/medium/high/xhigh/max
isolation: worktree                # Run in isolated git worktree
color: blue                        # Display color in UI
initialPrompt: "..."               # Auto-submitted as first user turn
mcpServers:                        # Scoped MCP servers
  - server_name:
      type: stdio
      command: npx
      args: ["..."]
hooks:                             # Scoped hooks (see Hooks section)
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./validate.sh"
---
System prompt body here...
```

**Subagent Scopes (priority):**
1. Managed settings (org-wide)
2. `--agents` CLI flag (session only)
3. `.claude/agents/` (project)
4. `~/.claude/agents/` (user)
5. Plugin `agents/` (lowest)

**Invocation Methods:**
- Natural language: "Use the X agent to..."
- @-mention: `@"agent-name (agent)"` or `@agent-agent-name`
- Session-wide: `claude --agent agent-name` or `"agent": "agent-name"` in settings
- Plugin agents scope: `my-plugin:agent-name` or `my-plugin:review:security` (subfolder)

**Fork Subagents (`/fork`):**
- Inherits full conversation context (not fresh start)
- System prompt, tools, model same as main session
- Runs in background by default
- Shared prompt cache with parent
- `/fork draft tests for parser changes`

**Memory Configuration:**
| Scope | Path | Use |
|---|---|---|
| `user` | `~/.claude/agent-memory/<name>/` | Cross-project learning |
| `project` | `.claude/agent-memory/<name>/` | Shareable via VCS |
| `local` | `.claude/agent-memory-local/<name>/` | Project-specific, gitignored |

**Plugin Agent Limitations:**
- `hooks`, `mcpServers`, `permissionMode` NOT supported for plugin-shipped agents
- Plugin agents support: `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation`

### Hooks Reference

Source: https://code.claude.com/docs/en/hooks

**Hook Lifecycle:**
- Once per session: `SessionStart`, `SessionEnd`
- Once per turn: `UserPromptSubmit`, `Stop`, `StopFailure`
- Per tool call: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`
- Async: `FileChanged`, `CwdChanged`, `ConfigChange`, `Notification`, `MessageDisplay`

**Hook Configuration Format:**
```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolName or pattern",
        "hooks": [
          {
            "type": "command|http|mcp_tool|prompt|agent",
            "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/handler.sh",
            "async": false,
            "asyncRewake": false,
            "shell": "bash",
            "timeout": 600,
            "if": "Bash(git *)",
            "statusMessage": "Running validation..."
          }
        ]
      }
    ]
  }
}
```

**Hook Types:**
| Type | Description |
|---|---|
| `command` | Execute shell script/command (with or without `args`) |
| `http` | POST event JSON to URL |
| `mcp_tool` | Call tool on configured MCP server |
| `prompt` | Evaluate with LLM (`$ARGUMENTS` for context) |
| `agent` | Run agentic verifier with tools |

**Matcher Patterns:**
| Pattern | Evaluation | Example |
|---|---|---|
| `"*"`, `""`, omitted | Match all | Every occurrence |
| Letters, digits, `_`, `\|` | Exact string/list | `Bash` or `Edit\|Write` |
| Other characters | Regex | `^Notebook` or `mcp__codegraph__.*` |

**Exit Codes:**
- `0`: success, parse JSON from stdout
- `2`: blocking error, show stderr, block action
- Other: non-blocking error, show first line of stderr

**Hook Locations (merge order, later overrides):**
1. Plugin `hooks/hooks.json`
2. Project `.claude/settings.json`
3. Project `.claude/settings.local.json`
4. User `~/.claude/settings.json`

**Decision Control:**
| Event | Pattern | Key Fields |
|---|---|---|
| `PreToolUse` | hookSpecificOutput | `permissionDecision: "allow"\|"deny"\|"ask"`, `permissionDecisionReason` |
| `UserPromptSubmit` | Top-level | `decision: "block"`, `reason` |
| `PermissionRequest` | hookSpecificOutput | `decision.behavior: "allow"\|"deny"` |

### MCP & LSP Configuration

Source: https://code.claude.com/docs/en/plugins-reference

**MCP in `.mcp.json`:**
```json
{
  "mcpServers": {
    "server-name": {
      "command": "\"${CLAUDE_PLUGIN_ROOT}\"/servers/my-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": { "DB_PATH": "${CLAUDE_PLUGIN_ROOT}/data" }
    }
  }
}
```

**LSP in `.lsp.json`:**
```json
{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": { ".go": "go" }
  }
}
```
LSP binary must be installed separately (not bundled in plugin).

### Plugin CLI Commands

Source: https://code.claude.com/docs/en/plugins-reference

| Command | Purpose |
|---|---|
| `claude plugin init <name>` | Scaffold new plugin at `~/.claude/skills/<name>/` |
| `claude plugin install <plugin>` | Install from marketplace |
| `claude plugin uninstall <plugin>` | Remove plugin |
| `claude plugin enable/disable <plugin>` | Toggle plugin state |
| `claude plugin update <plugin>` | Update to latest version |
| `claude plugin list` | List installed plugins |
| `claude plugin details <name>` | Show component inventory + token cost |
| `claude plugin validate [path]` | Validate manifest and components |
| `claude plugin tag` | Create release git tag |
| `claude plugin prune` | Remove unused dependencies |
| `claude --debug` | Debug plugin loading details |

### Common Plugin Development Pitfalls

| Issue | Solution |
|---|---|
| Plugin not loading | Run `claude plugin validate` or `claude --debug` |
| Skills not appearing | `skills/` must be at plugin root, NOT in `.claude-plugin/` |
| Hooks not firing | Script must be executable: `chmod +x script.sh` |
| MCP server fails | Use `${CLAUDE_PLUGIN_ROOT}` for all plugin paths |
| Path errors | All paths must be relative and start with `./` |
| Components inside `.claude-plugin/` | Only `plugin.json` goes there; move everything else out |
| Hooks in `settings.json` after migration | Move to `hooks/hooks.json` in plugin
