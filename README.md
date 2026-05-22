# Coder Workflow

Production-ready Claude Code plugin for disciplined software engineering workflows: planning, implementation, architecture auditing, and Modular MVC + Service + Repository refactoring.

## Highlights

- Built-in planning discipline before significant code changes.
- `coder` skill for general implementation workflow.
- `refraktor` skill for Modular MVC + Service + Repository transformations.
- `auditor` skill for read-only layer, coupling, and verification audits.
- Focused agents for planning, implementation, and architecture review.
- Bash and PowerShell installers for user-level or project-level installation.

## Components

### Skills

| Skill | Purpose |
| --- | --- |
| `coder` | General coding workflow with planning, implementation, and verification discipline. |
| `refraktor` | Modular MVC + Service + Repository refactor workflow migrated from the previous `codegraph-mapper` command. |
| `auditor` | Read-only architecture and layer violation audit workflow. |

### Agents

| Agent | Purpose |
| --- | --- |
| `workflow-planner` | Read-only implementation planning and plan-mode recommendation. |
| `code-implementer` | Scoped code editing after a plan exists. |
| `architecture-auditor` | Read-only layer and coupling audit. |

## Installation

Install for the current user:

```bash
./install.sh
```

Install into the current project only:

```bash
./install.sh --project
```

Symlink components for plugin development:

```bash
./install.sh --link
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
```

Windows PowerShell equivalents:

```powershell
.\install.ps1
.\install.ps1 -Project
.\install.ps1 -Link
.\install.ps1 -DryRun
```

Restart Claude Code or run `/reload` after installation.

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
```

## Production checklist

- Keep `skills/` and `agents/` committed and reviewed like source code.
- Run `./install.sh --dry-run` before installing into shared environments.
- Use `./install.sh --project` for repository-specific workflows.
- Use `./install.sh --link` only during local plugin development.
- Keep audits read-only unless the user explicitly asks to implement fixes.
- Use Claude Code built-in plan mode before significant edits.

## Repository layout

```text
coder-workflow/
├── .claude-plugin/plugin.json
├── agents/
├── skills/
├── install.sh
├── install.ps1
├── LICENSE
└── README.md
```
