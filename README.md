# Coder Workflow

**Coder Workflow** is a Claude Code plugin and CLI toolkit for disciplined software engineering workflows: single-orchestrator routing, graph-first codebase understanding, specialized coding agents, safety hooks, and a CodeGraph MCP server.

It is designed for teams or solo developers who want Claude Code to behave like a structured engineering workflow rather than an ad-hoc chat assistant.

---

## What It Provides

- **Single orchestrator model** — `coder-orchestrator` routes coding work before implementation starts.
- **Graph-first codebase understanding** — CodeGraph MCP tools prefer dependency/call-graph queries over raw grep.
- **Specialized engineering agents** — planner, implementer, reviewer, debugger, tester, docs, UI, DB, DevOps, refactorer, auditor, and more.
- **Lifecycle hooks** — session startup, safety guards, graph refresh, task reminders, git operation warnings, and session summaries.
- **CLI + MCP server** — `coder-workflow` provides local commands and a stdio MCP server for Claude Code.
- **Persistent graph cache** — `.codegraph/graph.db` stores file/symbol/edge relationships using libSQL.
- **Safety and verification** — dry-run CLI support, MCP health check, build checksums, CI matrix, and test coverage integration.

---

## Architecture at a Glance

```text
User request
  ↓
Claude Code plugin discovery
  ↓
coder-orchestrator skill
  ↓
Specialized agents
  ├─ workflow-planner
  ├─ code-implementer
  ├─ architecture-auditor
  ├─ debugging-engineer
  ├─ test-engineer
  ├─ code-reviewer
  ├─ docs-engineer
  ├─ ui-engineer
  ├─ db-architect
  ├─ devops-engineer
  └─ ...
  ↓
CodeGraph MCP tools
  ├─ scan_codebase
  ├─ query_graph
  ├─ analyze_impact
  ├─ search_code
  ├─ find_cycles
  ├─ find_orphans
  ├─ quality_gate
  └─ ping
  ↓
.codegraph/graph.db
```

---

## Installation

### Global install

Installs to `~/.claude/skills/coder-workflow/`, builds the CLI, and configures MCP.

```bash
./install.sh
```

### Development symlink

Use this when actively editing the plugin repository.

```bash
./install.sh --link
```

### Project-local install

Installs into the current project only.

```bash
./install.sh --project
```

### MCP-only install

```bash
./install.sh --mcp-only
```

After installation, restart Claude Code or run:

```text
/reload-plugins
```

---

## MCP Configuration

The plugin ships with `.mcp.json`:

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "coder-workflow",
      "args": ["mcp"],
      "env": {
        "CODEGRAPH_DEFAULT_UI_PORT": "3737"
      }
    }
  }
}
```

Start the MCP server directly:

```bash
npm run start:mcp
# or
coder-workflow mcp
```

Health check through MCP is available as the `ping` tool. It reports server status, uptime, tool call count, cache state, and graph lock state.

---

## CLI Usage

```bash
coder-workflow help
```

Common commands:

```bash
# Build or refresh graph database
coder-workflow scan

# Preview scan output without writing .codegraph/graph.db
coder-workflow scan --dry-run

# Incremental update
coder-workflow update

# Query graph relationships
coder-workflow query "GraphDatabase"

# Analyze impact radius
coder-workflow impact "src/graph/db.ts"

# Search source text
coder-workflow search "TODO|FIXME" --regex --context 2

# Find cycles and orphans
coder-workflow cycles
coder-workflow orphans

# Architecture and quality
coder-workflow summary
coder-workflow quality --fail-on high

# Export graph artifacts
coder-workflow export json mermaid html

# Compare graph JSON snapshots
coder-workflow diff before.json after.json

# UI / dashboard
coder-workflow ui
coder-workflow dashboard
```

---

## Skills

When loaded as a Claude Code plugin, skills are namespaced as `/coder-workflow:<skill>`.

| Skill | Purpose |
|---|---|
| `/coder-workflow:coder-orchestrator` | Required entry point for coding tasks; routes work to the right agents. |
| `/coder-workflow:coder-workflow` | Main user-facing coding workflow trigger. |
| `/coder-workflow:plan` | Decompose a coding request into scoped tasks. |
| `/coder-workflow:audit` | Read-only architecture and layer violation audit. |
| `/coder-workflow:refraktor` | Refactor toward Modular MVC + Service + Repository. |
| `/coder-workflow:debug` | Root-cause analysis for bugs and failures. |
| `/coder-workflow:test` | Test strategy, scaffolding, and coverage. |
| `/coder-workflow:review` | Security and edge-case review. |
| `/coder-workflow:deploy` | Docker, CI/CD, GHCR, Traefik, VPS deployment workflows. |
| `/coder-workflow:ui` | Frontend UI, CSS, state, and accessibility work. |
| `/coder-workflow:db` | Schema, migration, indexing, and query optimization work. |
| `/coder-workflow:docs` | README, API specs, inline docs, and PR docs. |
| `/coder-workflow:diagram` | Mermaid diagrams from codebase graph data. |
| `/coder-workflow:memory` | Long-term agentic memory operations. |
| `/coder-workflow:multirepo` | Multi-repository contract and architecture coordination. |
| `/coder-workflow:timetravel` | Auto-bisect / rollback investigation. |
| `/coder-workflow:brainstorming` | Clarify requirements before creative or underspecified work. |
| `/coder-workflow:dispatching-parallel-agents` | Force aggressive parallel decomposition where safe. |
| `/coder-workflow:writing-skills` | Build or verify Claude Code skills. |

---

## Agents

Agent metadata is centralized in `agents/registry.json`.

| Agent | Role |
|---|---|
| `workflow-planner` | Task decomposition and dependency ordering. |
| `code-implementer` | Scoped implementation after planning. |
| `architecture-auditor` | Read-only architecture and layer audit. |
| `code-reviewer` | Security, correctness, and edge-case review. |
| `debugging-engineer` | Root-cause analysis and bug tracing. |
| `test-engineer` | Test scaffolding and coverage analysis. |
| `refactoring-engineer` | Structural refactors and modular architecture. |
| `devops-engineer` | Docker, CI/CD, registry, VPS, Traefik. |
| `docs-engineer` | Documentation synchronization. |
| `ui-engineer` | Frontend UI and accessibility. |
| `db-architect` | Database schema and query work. |
| `todo-checker` | TODO/FIXME/dummy-code scan. |
| `diagram-engineer` | Mermaid architecture diagrams. |
| `rollback-engineer` | Git bisect and rollback investigation. |
| `memory-librarian` | Long-term memory lookup and storage. |
| `multi-repo-orchestrator` | Cross-repository coordination. |

---

## Hooks

Hooks live in `hooks/hooks.json` with companion scripts in `hooks/scripts/`.

Major hook capabilities:

- **Session startup** — banner, graph status, plugin conflict detection, auto-scan if needed.
- **Prompt submission** — skill detection and prompt logging.
- **Safety guards** — dangerous `rm`, force-push to main/master, hard reset, destructive SQL, unsafe `.env` writes.
- **Write/Edit handling** — impact-radius reminder and debounced graph update.
- **Git operation awareness** — branch switch, merge, push, commit notices.
- **Subagent depth tracking** — warns when nesting exceeds the safe depth limit.
- **Stop hook** — waits for graph updates before auto-commit/session summary.
- **Log rotation** — trims oversized session logs.
- **Hook JSON validation helpers** — `hooks/scripts/validate-hook-json.sh`.

---

## CodeGraph MCP Tools

| Tool | Purpose |
|---|---|
| `scan_codebase` | Full graph scan and database refresh. |
| `update_codebase` | Update only changed files. |
| `query_graph` | Query definitions, references, calls, imports, routes, handlers. |
| `analyze_impact` | Upstream/downstream impact analysis. |
| `search_code` | Source text search with regex/context filters. |
| `find_cycles` | Detect circular dependencies. |
| `find_orphans` | Identify orphan files/symbols. |
| `summarize_architecture` | Architecture summary and hotspots. |
| `analyze_quality` | Graph quality analysis. |
| `quality_gate` | Threshold-based quality gate. |
| `export_graph` | Export JSON, Mermaid, DOT, Markdown, HTML. |
| `summarize_graph` | Bounded graph summary for token budgets. |
| `check_graph_freshness` | Graph DB freshness check. |
| `diff_graphs` | Compare graph snapshots. |
| `list_directory_tree` | Directory tree visualization. |
| `open_graph_ui` | Start local graph UI. |
| `ping` | MCP server health check. |

---

## Development

```bash
# Install dependencies
npm ci

# Build CLI + MCP + tests
npm run build

# Typecheck
npm run typecheck

# Run tests with coverage threshold
npm run test

# Lint / format
npm run lint
npm run format
npm run check

# Scan current repository
npm run scan

# Open graph UI
npm run ui

# Start dashboard
npm run dashboard
```

Build output includes `dist/MANIFEST.json`, a SHA-256 checksum manifest for generated `.js` files.

---

## Verification

Recommended before publishing or pushing:

```bash
npm run typecheck
npm run build
node --test dist/test/graph.test.js
coder-workflow scan --dry-run
coder-workflow help
```

CI runs validation, build, typecheck, lint, and tests. Build/typecheck also run on a matrix of:

- Ubuntu
- Windows
- macOS

---

## Repository Layout

```text
coder-workflow/
├── .claude-plugin/plugin.json
├── .mcp.json
├── CLAUDE.md
├── README.md
├── package.json
├── esbuild.config.mjs
├── src/
│   ├── cli.ts
│   ├── mcp-server.ts
│   ├── graph.ts
│   ├── graph/
│   ├── analysis/
│   ├── search.ts
│   ├── exporters.ts
│   └── ui.ts
├── skills/
│   ├── coder-orchestrator/
│   ├── brainstorming/
│   ├── dispatching-parallel-agents/
│   └── writing-skills/
├── agents/
│   ├── registry.json
│   ├── workflow-planner.md
│   ├── code-implementer.md
│   └── ...
├── commands/
├── hooks/
│   ├── hooks.json
│   └── scripts/
├── docs/
├── test/
├── install.sh
└── install.ps1
```

---

## Operating Principles

1. **Route coding work through the orchestrator.**
2. **Use graph tools before raw search where possible.**
3. **Track tasks and discovered bugs.**
4. **Prefer subagents for heavy reading, implementation, testing, and review.**
5. **Keep graph state fresh after edits and git operations.**
6. **Verify targeted changes before completing work.**
7. **Avoid dummy code, suppressions, and band-aid fixes.**

---

## License

MIT
