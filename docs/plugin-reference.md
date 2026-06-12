# Official Plugin Documentation Reference

_Last crawled: 2026-06-04_

Official documentation source for the Claude Code plugin. Use these references when modifying or developing this plugin.

Source: https://code.claude.com/docs/en/plugins
Source: https://code.claude.com/docs/en/plugins-reference
Source: https://code.claude.com/docs/en/skills
Source: https://code.claude.com/docs/en/sub-agents
Source: https://code.claude.com/docs/en/hooks

---

## Plugin System Overview

### Plugin vs Standalone

| Approach | Skill Names | Best For |
|---|---|---|
| Standalone (`.claude/` dir) | `/hello` | Personal workflows, project-specific, quick experiments |
| Plugin (self-contained dir) | `/plugin-name:hello` | Sharing, distribution, reusable across projects |

### Plugin Directory Structure

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
| `bin/` | Plugin root | Executables added to PATH |
| `settings.json` | Plugin root | Default settings applied when enabled |

### Key Rules

- WARNING: `.claude-plugin/` only contains `plugin.json`. All other dirs (`skills/`, `agents/`, `hooks/`, `commands/`) go at plugin root, NOT inside `.claude-plugin/`.
- Plugin skills are namespaced: `/plugin-name:skill-name`
- Test with `claude --plugin-dir ./path/to/plugin`
- Run `/reload-plugins` after changes (no restart needed)
- Convert standalone `.claude/` to plugin: copy files, move hooks from `settings.json` to `hooks/hooks.json`

### Skills-Directory Plugin (used by this project)

- Any folder under `~/.claude/skills/` or `.claude/skills/` with `.claude-plugin/plugin.json` loads as `<name>@skills-dir`
- Scaffold: `claude plugin init <name>` -> creates `~/.claude/skills/<name>/`
- Project-scope: requires workspace trust dialog
- Disable: `claude plugin disable <name>@skills-dir`

---

## Plugin Manifest Schema (`plugin.json`)

```json
{
  "name": "plugin-name",
  "displayName": "Plugin Name",
  "version": "1.2.0",
  "description": "...",
  "author": {"name": "...", "email": "...", "url": "..."},
  "homepage": "https://...",
  "repository": "https://...",
  "license": "MIT",
  "keywords": ["..."],
  "defaultEnabled": true,
  "skills": "./custom/skills/",
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

### Environment Variables for Plugin Paths

| Variable | Purpose | Example |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin installation dir | `"${CLAUDE_PLUGIN_ROOT}/scripts/format.sh"` |
| `${CLAUDE_PLUGIN_DATA}` | Persistent data dir (survives updates) | `"${CLAUDE_PLUGIN_DATA}/node_modules"` |
| `${CLAUDE_PROJECT_DIR}` | Project root | `"${CLAUDE_PROJECT_DIR}/.env"` |
| `${user_config.KEY}` | User-config value | `${user_config.api_key}` |

### Version Management

- Explicit `version` in `plugin.json`: users only get updates when you bump
- No version = git commit SHA: every commit = new version
- Tag releases: `claude plugin tag --push`

---

## Skills Reference

Source: https://code.claude.com/docs/en/skills

### SKILL.md Format

```yaml
---
description: What this skill does and when Claude should use it
disable-model-invocation: true
user-invocable: false
context: fork
agent: Explore
allowed-tools: Read Grep Bash
disallowed-tools: Edit Write
model: sonnet
effort: high
argument-hint: "[issue-number]"
arguments: [issue, branch]
paths: "src/**/*.ts"
shell: bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./validate.sh"
---
```

### String Substitutions

| Variable | Description |
|---|---|
| `$ARGUMENTS` | All arguments passed to skill |
| `$ARGUMENTS[N]` / `$N` | Specific argument by 0-based index |
| `$name` | Named argument from `arguments` frontmatter |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_EFFORT}` | Current effort level |
| `${CLAUDE_SKILL_DIR}` | Skill's directory path |

### Dynamic Context Injection

- `` !`command` `` — runs shell command, replaces line with output (preprocessing, runs before Claude sees content)
- `` ```! `` — fenced block for multi-line commands
- Set `disableSkillShellExecution: true` in settings to disable

### context: fork Behavior

- Skill content becomes the subagent's prompt
- Uses agent type specified in `agent` field (default: `general-purpose`)
- Explore/Plan agents skip CLAUDE.md and git status for smaller context
- Subagent result returns to main conversation as summary

### Skill Content Lifecycle

- Rendered SKILL.md enters conversation as one message, stays for rest of session
- Auto-compaction carries forward most recent invocation (first 5000 tok)
- Combined budget of 25000 tok across re-attached skills
- Re-invoke after compaction to restore full content

### Skill Locations & Priority

| Location | Scope |
|---|---|
| Enterprise (managed) | Organization-wide, highest priority |
| Personal `~/.claude/skills/` | All your projects |
| Project `.claude/skills/` | This project only |
| Plugin `<plugin>/skills/` | Where plugin enabled, namespaced |

---

## Subagents Reference

Source: https://code.claude.com/docs/en/sub-agents

### Built-in Agents (DO NOT USE — use `coder-workflow:explore-codebase` instead)

| Agent | Model | Tools | Purpose |
|---|---|---|---|
| ~~Explore~~ | ~~Haiku~~ | ~~Read-only~~ | ~~DO NOT USE — use `coder-workflow:explore-codebase`~~ |
| Plan | Inherits | Read-only | Codebase research for planning |
| General-purpose | Inherits | All tools | Complex multi-step tasks |

### Subagent Definition Format

```markdown
---
name: agent-name
description: What this agent does
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
model: sonnet
permissionMode: auto
maxTurns: 20
skills: [skill-name]
memory: user
background: true
effort: high
isolation: worktree
color: blue
initialPrompt: "..."
mcpServers:
  - server_name:
      type: stdio
      command: npx
      args: ["..."]
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./validate.sh"
---
System prompt body here...
```

### Subagent Scopes (priority)

1. Managed settings (org-wide)
2. `--agents` CLI flag (session only)
3. `.claude/agents/` (project)
4. `~/.claude/agents/` (user)
5. Plugin `agents/` (lowest)

### Invocation Methods

- Natural language: "Use the X agent to..."
- @-mention: `@"agent-name (agent)"` or `@agent-agent-name`
- Session-wide: `claude --agent agent-name` or `"agent": "agent-name"` in settings
- Plugin agents scope: `my-plugin:agent-name` or `my-plugin:review:security` (subfolder)

### Fork Subagents (`/fork`)

- Inherits full conversation context (not fresh start)
- System prompt, tools, model same as main session
- Runs in background by default
- Shared prompt cache with parent

### Memory Configuration

| Scope | Path | Use |
|---|---|---|
| `user` | `~/.claude/agent-memory/<name>/` | Cross-project learning |
| `project` | `.claude/agent-memory/<name>/` | Shareable via VCS |
| `local` | `.claude/agent-memory-local/<name>/` | Project-specific, gitignored |

### Plugin Agent Limitations

- `hooks`, `mcpServers`, `permissionMode` NOT supported for plugin-shipped agents
- Plugin agents support: `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation`

---

## Hooks Reference

Source: https://code.claude.com/docs/en/hooks

### Hook Lifecycle

- Once per session: `SessionStart`, `SessionEnd`
- Once per turn: `UserPromptSubmit`, `Stop`, `StopFailure`
- Per tool call: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`
- Async: `FileChanged`, `CwdChanged`, `ConfigChange`, `Notification`, `MessageDisplay`

### Hook Configuration Format

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

### Hook Types

| Type | Description |
|---|---|
| `command` | Execute shell script/command |
| `http` | POST event JSON to URL |
| `mcp_tool` | Call tool on configured MCP server |
| `prompt` | Evaluate with LLM |
| `agent` | Run agentic verifier with tools |

### Matcher Patterns

| Pattern | Evaluation | Example |
|---|---|---|
| `"*"`, `""`, omitted | Match all | Every occurrence |
| Letters, digits, `_`, `\|` | Exact string/list | `Bash` or `Edit\|Write` |
| Other characters | Regex | `^Notebook` or `mcp__codegraph__.*` |

### Exit Codes

- `0`: success, parse JSON from stdout
- `2`: blocking error, show stderr, block action
- Other: non-blocking error, show first line of stderr

### Hook Locations (merge order, later overrides)

1. Plugin `hooks/hooks.json`
2. Project `.claude/settings.json`
3. Project `.claude/settings.local.json`
4. User `~/.claude/settings.json`

### Decision Control

| Event | Pattern | Key Fields |
|---|---|---|
| `PreToolUse` | hookSpecificOutput | `permissionDecision: "allow"\|"deny"\|"ask"` |
| `UserPromptSubmit` | Top-level | `decision: "block"` |
| `PermissionRequest` | hookSpecificOutput | `decision.behavior: "allow"\|"deny"` |

---

## MCP & LSP Configuration

Source: https://code.claude.com/docs/en/plugins-reference

### MCP in `.mcp.json`

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

### LSP in `.lsp.json`

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

---

## Plugin CLI Commands

| Command | Purpose |
|---|---|
| `claude plugin init <name>` | Scaffold new plugin |
| `claude plugin install <plugin>` | Install from marketplace |
| `claude plugin uninstall <plugin>` | Remove plugin |
| `claude plugin enable/disable <plugin>` | Toggle plugin state |
| `claude plugin update <plugin>` | Update to latest version |
| `claude plugin list` | List installed plugins |
| `claude plugin details <name>` | Component inventory + token cost |
| `claude plugin validate [path]` | Validate manifest and components |
| `claude plugin tag` | Create release git tag |
| `claude plugin prune` | Remove unused dependencies |
| `claude --debug` | Debug plugin loading details |

---

## Common Plugin Development Pitfalls

| Issue | Solution |
|---|---|
| Plugin not loading | Run `claude plugin validate` or `claude --debug` |
| Skills not appearing | `skills/` must be at plugin root, NOT in `.claude-plugin/` |
| Hooks not firing | Script must be executable: `chmod +x script.sh` |
| MCP server fails | Use `${CLAUDE_PLUGIN_ROOT}` for all plugin paths |
| Path errors | All paths must be relative and start with `./` |
| Components inside `.claude-plugin/` | Only `plugin.json` goes there; move everything else out |
| Hooks in `settings.json` after migration | Move to `hooks/hooks.json` in plugin |
