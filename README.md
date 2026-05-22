# Coder Workflow

Claude Code plugin for disciplined software engineering workflows: planning, implementation, architecture auditing, and Modular MVC + Service + Repository refactoring.

## Components

### Skills

- `coder` — general coding workflow with planning, implementation, and verification discipline.
- `refraktor` — Modular MVC + Service + Repository refactor workflow migrated from the previous `codegraph-mapper` command.
- `auditor` — read-only architecture and layer violation audit workflow.

### Agents

- `workflow-planner` — read-only implementation planning and plan-mode recommendation.
- `code-implementer` — scoped code editing after a plan exists.
- `architecture-auditor` — read-only layer and coupling audit.

## Local testing

```bash
cc --plugin-dir /mnt/code/djnaidwhbwda/coder-workflow
```

Trigger examples:

- `implement this feature with proper planning`
- `audit architecture and find fat controllers`
- `refractor src/modules/user to controller service repository`

## Notes

Use Claude Code built-in plan mode before significant edits. Keep audits read-only unless the user explicitly asks to implement fixes.
