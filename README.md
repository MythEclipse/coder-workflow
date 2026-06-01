# Coder Workflow

Orchestrator-driven Claude Code plugin for disciplined software engineering: aggressive task decomposition, skill-first routing, persistent execution, and zero-tolerance bug discovery.

## Highlights

- **`coder-orchestrator`** — single orchestrator for coding work AND codebase exploration (graph before grep, query before read)
- **Mandatory sub-agent sequence** — workflow-planner → architecture-auditor → code-implementer → architecture-auditor (post-verify)
- **Bug Discovery Mandate** — every bug found must be tracked as a low-priority task and fixed at the end of the session, preventing feature starvation
- **Research-first** — context7 MCP for docs, codegraph MCP for code search, never guess API behavior
- **Task tracking** — TaskCreate/TaskUpdate for every unit of work, right-sized task decomposition to prevent context exhaustion
- `coder` skill for general implementation workflow
- `refraktor` skill for Modular MVC + Service + Repository transformations
- `auditor` skill for read-only architecture audits
- `deploy-docker` skill for GitHub Actions → GHCR → VPS → Traefik deployments
- `batch-codegraph` skill for parallel file read/search operations
- Slash commands: `/coder-workflow`, `/audit`, `/plan`
- Auto-hooks for post-file-change reminders and session-end verification

## Components

### Skills

| Skill | Purpose |
| --- | --- |
| `coder-orchestrator` | **Central orchestrator** — always triggers, decomposes tasks, routes to ALL agents, enforces bug discovery, handles codebase exploration |
| `coder` | General coding workflow with planning, implementation, verification, and bug fix phase |
| `refraktor` | Modular MVC + Service + Repository refactor with mandatory planning gate |
| `auditor` | Read-only architecture and layer violation audit with codegraph MCP integration |
| `deploy-docker` | Docker deploy workflow for GHCR, VPS, Docker Compose, Traefik |
| `batch-codegraph` | Parallel file read/search operations with bounded concurrency |

### Agents

| Agent | Purpose | When invoked |
| --- | --- | --- |
| `workflow-planner` | Right-sized task decomposition | ALWAYS, first agent in sequence |
| `architecture-auditor` | Pre/post architecture review, violation detection | ALWAYS, before AND after implementation |
| `code-implementer` | Scoped code execution after plan approval | ALWAYS, after pre-audit |

### Commands

| Command | Purpose |
| --- | --- |
| `/coder-workflow` | Main orchestrator trigger — starts full agent sequence |
| `/audit` | Quick architecture audit of current project |
| `/plan` | Task decomposition for a specific coding request |

### Hooks

| Hook | Trigger | Purpose |
| --- | --- | --- |
| `PostToolUse` | After Write/Edit/NotebookEdit | Remind to track discovered bugs, refresh codegraph if exists |
| `Stop` | Session end | Verify all tasks completed, all bugs fixed, verification passed |

## Installation

**Default (global):** Installs to `~/.claude/skills/coder-workflow/` — Claude Code auto-discovers and loads the plugin on every session start.

```bash
./install.sh
```

Symlink for development (so changes to the repo are immediately reflected):

```bash
./install.sh --link
```

Install into the current project only (`.claude/` directory):

```bash
./install.sh --project
```

Preview install actions without changing files:

```bash
./install.sh --dry-run
```

Install selected components only:

```bash
./install.sh refraktor architecture-auditor
./install.sh --skills-only coder auditor
./install.sh --agents-only workflow-planner
./install.sh --hooks-only
./install.sh --commands-only
```

Windows PowerShell equivalents:

```powershell
.\install.ps1
.\install.ps1 -Project
.\install.ps1 -Link
.\install.ps1 -DryRun
```

**After installation:** Restart Claude Code or run `/reload-plugins` to load the new plugin.

## Skill names

When installed as a plugin, skills are namespaced:

| Skill | Command |
|-------|---------|
| coder-orchestrator | `/coder-workflow:coder-orchestrator` |
| coder | `/coder-workflow:coder` |
| auditor | `/coder-workflow:auditor` |
| refraktor | `/coder-workflow:refraktor` |
| deploy-docker | `/coder-workflow:deploy-docker` |
| batch-codegraph | `/coder-workflow:batch-codegraph` |

Commands are namespaced too:

| Command | Slash command |
|---------|---------------|
| coder-workflow | `/coder-workflow:coder-workflow` |
| audit | `/coder-workflow:audit` |
| plan | `/coder-workflow:plan` |

## Local testing

```bash
cc --plugin-dir /mnt/code/djnaidwhbwda/coder-workflow
```

Trigger examples:

```text
implement this feature with proper planning
audit architecture and find fat controllers
refractor src/modules/user to controller service repository
cek struktur controller service repository
setup deploy Docker GHCR VPS Traefik
```

## Deploy guide

See `docs/docker-ghcr-vps-traefik-deploy.md` for the general Docker deploy template covering GitHub Actions, GHCR, VPS, Docker Compose, Traefik labels, secrets, verification, and 404/502 debugging.

## Workflow Architecture

See `docs/design/workflow-architecture.md` for the full design philosophy, agent coordination pattern, bug discovery mandate, learning protocol, and comparison with codegraph-mapper.

## Production checklist

- Keep `skills/`, `agents/`, `commands/`, and `docs/` committed and reviewed like source code.
- Run `./install.sh --dry-run` before installing into shared environments.
- Use `./install.sh --project` for repository-specific workflows.
- Use `./install.sh --link` only during local plugin development.
- Keep audits read-only unless the user explicitly asks to implement fixes.
- Use Claude Code built-in plan mode before significant edits.
- **Every discovered bug gets tracked as a low-priority task** and fixed at the end of the session.
- **Always use sub-agents** — orchestrator routes, agents do the work.
- **Research before guessing** — context7 MCP for docs, codegraph MCP for code search.

## Repository layout

```text
coder-workflow/
├── .claude-plugin/plugin.json
├── CLAUDE.md
├── package.json
├── hooks/
│   └── hooks.json
├── commands/
│   ├── coder-workflow.md
│   ├── audit.md
│   └── plan.md
├── agents/
│   ├── workflow-planner.md
│   ├── architecture-auditor.md
│   └── code-implementer.md
├── skills/
│   ├── coder-orchestrator/
│   │   ├── SKILL.md
│   │   └── references/orchestration-guide.md
│   ├── coder/
│   │   ├── SKILL.md
│   │   └── references/workflow-checklist.md
│   ├── auditor/
│   │   ├── SKILL.md
│   │   └── references/audit-checklist.md
│   ├── refraktor/
│   │   ├── SKILL.md
│   │   └── references/layer-contract.md
│   ├── deploy-docker/
│   │   ├── SKILL.md
│   │   └── references/deploy-guide.md
│   └── batch-codegraph/
│       └── SKILL.md
├── docs/
│   ├── docker-ghcr-vps-traefik-deploy.md
│   └── design/
│       └── workflow-architecture.md
├── install.sh
├── install.ps1
├── LICENSE
└── README.md
```
