# Workflow Architecture Design

## Design Philosophy

Coder Workflow is built on six core principles:

1. **Tasks tracking** — It is recommended to use `TaskCreate` early, but initial codebase exploration using read-only tools is permitted before task creation.
2. **Skills before guesses** — Always route to the appropriate skill, never implement ad-hoc
3. **MCP before grep** — Prioritize codegraph/context7 MCP tools. Fallback to raw grep gracefully if services fail.
4. **Context7 before assumptions** — Never guess framework/API behavior, query docs first
5. **Never give up** — If stuck, decompose further, research more, ask clarifying questions
6. **Bounded Bug Tracking** — Track bugs as tasks but apply bounded limits to prevent tech debt rabbit holes causing feature starvation.
7. **Situational TDD** — Test-Driven Development is highly encouraged but situational (skip for UI/configs).
8. **Parallel Reconnaissance** — Planning leverages multiple subagents for fast structural mapping.

## Architecture

```
coder-orchestrator (SKILL.md)
├── workflow-planner (agent)     → decomposes requests into tasks
├── architecture-auditor (agent) → pre/post architecture review
└── code-implementer (agent)     → executes approved plans

Skills:
├── coder            → implementation workflow
├── auditor          → architecture audit
├── refraktor        → Modular MVC refactor
├── deploy-docker    → Docker/CI/CD deploy
└── batch-codegraph  → parallel operations

Commands:
├── /coder-workflow  → main orchestrator trigger
├── /audit           → architecture audit
└── /plan            → task decomposition

Hooks:
├── PostToolUse      → reminder to track bugs after file changes
└── Stop             → session-end verification checklist
```

## Agent Coordination Pattern

The orchestrator uses an adaptable agent sequence with a **Fast-Path bypass** for trivial tasks:

```
[Trivial Task] → code-implementer (Fast-Path Bypass)
[Complex Task] → workflow-planner (spawns parallel explorer subagents) → [architecture-auditor] → code-implementer → [architecture-auditor]
```

This ensures:
- Trivial changes bypass heavy orchestration overhead.
- Planning for complex tasks uses parallel reconnaissance for speed.
- Dynamic Architecture Detection handles FSD, Serverless, and MVC without false positives.
- Implementation is scoped to the plan with Situational TDD.

## Bug Discovery Mandate

The key differentiator from other workflows: **every bug discovered during work MUST be tracked.**

This prevents the common pattern where AI agents say "pre-existing warning, not related to my changes". To prevent feature starvation and scope creep, bugs must be tracked as low-priority tasks and fixed at the end of the session.

Severity classification:
- **Blocker**: crashes, data loss, security → track and fix as soon as possible
- **High**: broken functionality, failed tests → track and fix at the end of the session
- **Medium**: deprecation warnings, console errors → track and fix at the end of the session
- **Low**: cosmetic issues → track, fix if time permits

## Learning Protocol

When the orchestrator encounters unfamiliar territory:
1. Stop and research (do not guess)
2. Use context7 MCP for current documentation
3. Implement based on documentation
4. Store successful learnings for future sessions

This prevents the "let me try the most likely answer" pattern that leads to incorrect implementations.

## Comparison with codegraph-mapper

| Aspect | codegraph-mapper | coder-workflow |
|--------|------------------|----------------|
| Focus | Codebase understanding | Coding execution |
| Primary tool | CodeGraph MCP | Task tracking + Agent routing |
| Orchestrator | Graph-first routing | Agent-first routing |
| Output | Architecture maps | Implemented code + verification |
| Hook | Graph refresh | Bug tracking reminder |
| Learning | Graph scan | Context7 documentation lookup |

Both plugins share the same plugin structure: skills, agents, commands, hooks, and CLAUDE.md.
