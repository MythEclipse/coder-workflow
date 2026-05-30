---
name: coder-orchestrator
description: Route all coding work through aggressive task decomposition, skill-first execution, and persistent planning. Trigger on any coding request — features, bugs, refactors, reviews, deployments. Decompose into many small tracked tasks. Use skills and MCP tools before guessing. Learn via context7 before acting on unknown frameworks. Never give up.
version: 0.1.0
---

# Coder Orchestrator

Route every coding request through disciplined task decomposition, skill-first routing, and persistent execution. The orchestrator is the central brain for every coding session.

## Core Rules

1. **Tasks before tools.** Every coding request MUST be decomposed into tracked tasks via `TaskCreate`.
2. **Skills before guesses.** Always route to the appropriate skill — never implement ad-hoc when a skill exists.
3. **MCP before grep.** Use codegraph MCP tools for code search, impact analysis, and architecture queries.
4. **Context7 before assumptions.** Never guess framework/API behavior — query context7 MCP for current docs.
5. **Never give up.** If stuck, decompose further, research more, ask clarifying questions.

## Trigger

- **Always trigger** at session start for any coding, implementation, bug fix, refactor, review, or deployment request
- User asks to build, fix, debug, refactor, audit, test, or deploy code
- Any request that touches source files, configuration, CI/CD, or infrastructure
- **Trigger even without explicit skill mention** — the orchestrator decides the route
- If multiple skills apply, use ALL of them in dependency order

## Do Not Use

- Pure informational questions with no code changes needed
- Questions already answered by existing documentation without implementation

## Task Decomposition Mandate

**Aggressively decompose every request.** Target: 5-20+ tasks for non-trivial work. Each task should be:
- Narrowly scoped (one function, one bug, one test, one file refactor)
- Independently verifiable (typecheck, test, or manual check)
- Ordered by dependency (foundation → implementation → integration → verification)

**NEVER create a single "implement X" task.** If the request is "add authentication," decompose into: schema definition, password hashing service, token generation service, session repository, auth middleware, route handlers, error types, unit tests per service method, integration tests per endpoint, security audit, manual verification.

## Skill Routing Matrix

| Request Type | Route To | When |
|---|---|---|
| Implement feature, fix bug, write tests | `coder` | Default for any implementation work |
| Audit architecture, layer violations, fat controllers | `auditor` | Read-only architecture review |
| Refactor to Modular MVC + Service + Repository | `refraktor` | Structural reorganization |
| Setup Docker, CI/CD, VPS deploy, Traefik | `deploy-docker` | Deployment infrastructure |

## MCP Tool Routing

| Question Type | Use MCP Tool |
|---|---|
| "How do I use X framework/library?" | `context7` MCP → query docs |
| "Who calls function Y?" | `mcp__codegraph__query_graph` |
| "What's impacted if I change X?" | `mcp__codegraph__analyze_impact` |
| "What's the architecture?" | `mcp__codegraph__summarize_architecture` |
| "Find cycles, orphans, hotspots" | `mcp__codegraph__find_cycles`, `find_orphans`, `analyze_quality` |
| "Build/refresh graph" | `mcp__codegraph__scan_codebase` |
| Exact literal/regex search | `mcp__codegraph__search_code` |
| Read file | `mcp__codegraph__read_file` |

## Workflow

### Phase 1: Understand & Decompose

1. Restate the goal in one sentence when ambiguity exists
2. Inspect current state: git status, relevant files, project structure
3. Use codegraph MCP for cross-file relationships, architecture, impact
4. **Decompose aggressively** — create `TaskCreate` entries for every small step
5. Order tasks by dependency: foundation → schema → repository → service → controller → routes → integration → tests → verification

### Phase 2: Research & Learn (NEVER GUESS)

1. Identify knowledge gaps: what frameworks, APIs, or patterns are unfamiliar?
2. **Use `context7` MCP first** for library/framework documentation
3. Use `WebSearch` for recent changes, migration guides, community patterns
4. **After successful implementation**, store the learning via memory for future sessions
5. **NEVER** say "let me try the most likely answer" without researching the actual API/docs

### Phase 3: Route & Execute

1. Match each task to the appropriate skill from the routing matrix
2. Route to agents for larger work:
   - `workflow-planner` agent: unclear scope, multi-file decomposition
   - `architecture-auditor` agent: read-only architecture/layer review
   - `code-implementer` agent: scoped implementation after planning
3. Execute tasks in dependency order
4. Mark tasks `in_progress` before starting, `completed` when verified

### Phase 4: Verify Each Task

1. Run verification after each task: typecheck, lint, test, or manual check
2. **Do not claim completion** without verification evidence
3. If verification fails, create a new task for the fix, research the error, resolve

### Phase 5: Report

1. Summarize all completed tasks with file references (`path:line`)
2. Report verification results: commands run, outcomes, skipped checks
3. List remaining tasks or next steps with clear ownership
4. Document new learnings for future sessions

## Red Flags

| Anti-Pattern | Fix |
|---|---|
| Guessing instead of researching | Use context7 MCP or WebSearch |
| One giant task | Decompose into smaller tracked tasks |
| Skipping verification | Every task needs a verification gate |
| "I think this should work" | Verify with actual commands |
| Stale tasks accumulating | Clean up or complete them |
| Raw grep/find when MCP available | Use codegraph MCP tools |
| Assuming API behavior without docs | Query context7 for current documentation |
| Giving up on complex problems | Decompose further, research more, try different angles |
| "Let me just try the most likely answers" | Stop and research the actual API/docs first |

## Learning & Memory Protocol

When encountering unfamiliar territory:
1. **Stop and research** — do not guess
2. Use `context7` MCP for current documentation
3. Read docs and understand the pattern before implementing
4. Implement based on documentation, not memory
5. After successful implementation, store the learning with:
   - Framework/library name and version
   - Specific pattern or API learned
   - Working code example or configuration
   - Common pitfalls discovered

## Output Contract

State which skill handles each task and why. Ground answers in:
- Task list status (completed, in_progress, pending)
- File references (`path:line`)
- Verification results (commands run, pass/fail)
- Learnings documented for future sessions

Example:
```
Task: Add user authentication middleware
Route: coder → code-implementer agent
Research: context7 MCP for Express middleware pattern
Files: src/middleware/auth.ts:1 (new), src/routes/user.ts:12 (import added)
Verification: tsc clean, jest 3/3 passing, lint clean
Memory stored: Express middleware error handling with next() propagation
```

## Agent Coordination

- **workflow-planner**: Invoke when scope is unclear, multi-file work, or decomposition is needed. Pass concrete goals, relevant files, expected output, and constraints.
- **architecture-auditor**: Invoke for read-only architecture review, layer violation detection, refactor risk assessment.
- **code-implementer**: Invoke after a plan exists or explicit implementation target is defined. Do not delegate completely — verify each agent's output.

## Persistence Rules

- **Never give up** on a task — decompose, research, ask, try different angles
- **Never say "I don't know"** without first using MCP tools to find the answer
- **Never skip task tracking** — every piece of work gets a TaskCreate
- **Never verify by assumption** — run the actual commands
- **Never batch dependent tasks** — complete and verify each before starting the next
- **Never assume the graph is fresh** — scan if unsure
