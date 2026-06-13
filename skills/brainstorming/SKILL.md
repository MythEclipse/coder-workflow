---
name: brainstorming
description: "Use before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements, and design before implementation."
agent: general-purpose
---

# Brainstorming: Ideas to Spec

Turn vague ideas into approved designs through structured exploration. **No code until design is approved.**

## HARD GATE

Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until the spec is designed and user-approved. This applies to EVERY task regardless of perceived simplicity.

## Process

### 1. Explore Project Context

Use tools to understand current state:
- graph/mapping tools — understand codebase structure
- graph/mapping tools — find relevant modules
- `git log --oneline -10` — recent commits and active work
- `Read` relevant files — existing patterns, config

### 2. Clarify Requirements

One question per message. Focus on: purpose, constraints, success criteria.
- Prefer multiple-choice questions when possible
- Assess scope first — if the request covers multiple subsystems, flag for decomposition
- If too large for one spec, suggest sub-projects

### 3. Propose 2-3 Approaches

For each: trade-offs, complexity estimate, your recommendation with reasoning.

### 4. Present Design (Incremental Approval)

Present section-by-section, asking "does this look right?" after each. Cover:
- Architecture overview
- Components and their boundaries
- Data flow
- Error handling
- Testing strategy

Design for: **isolation** (single-purpose units), **clear interfaces**, **independent testability**.

### 5. Write Spec Document

Save to `docs/specs/YYYY-MM-DD-<topic>-design.md`

```markdown
# Design: [Title]
## Problem Statement
## Requirements
## Architecture
## Components
## Data Flow
## Error Handling
## Testing Strategy
## Open Questions
```

### 6. Spec Self-Review

Before asking user to review:
- [ ] No "TBD", "TODO" placeholders
- [ ] No internal contradictions between sections
- [ ] Scope focused enough for single implementation plan
- [ ] No ambiguous requirements (could be read two ways?)

### 7. User Reviews Spec

> "Spec written at `<path>`. Please review before we proceed to implementation planning."

### 8. Transition to Planning

Invoke the built-in planner with the `workflow-planner` skill for task decomposition.

**The ONLY step after brainstorming is using the built-in planner. Do NOT invoke `coder-orchestrator` or any implementation skill.**

## Key Principles

- One question at a time — don't overwhelm
- YAGNI ruthlessly — remove unnecessary features
- Explore alternatives — 2-3 approaches minimum
- Incremental validation — approve section by section
- Simple projects still need a design — just a shorter one

## Boundaries

- See `_shared/OVERPOWERED.md`.
