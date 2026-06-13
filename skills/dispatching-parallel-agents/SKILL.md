---
name: dispatching-parallel-agents
description: Instructs Claude Code to ALWAYS decompose tasks into parallel subagents whenever possible, regardless of token cost. Use this skill whenever working on any multi-file, multi-step, or multi-concern task in Claude Code.
agent: general-purpose
---

# Parallel Subagents — Always On

## Core Directive — 1 Task = 1 Subagent

Token cost is not a constraint. **If you have N independent tasks, you MUST spawn N subagents — one per task.** Do NOT give multiple tasks to a single agent. Do NOT execute tasks sequentially inside one agent. Each task gets its own dedicated subagent.

This is the fundamental rule: **parallelism = multiple subagents, not multiple tasks in one agent.**

```
✅ CORRECT: 10 tasks → 10 subagents (each runs independently)
❌ WRONG:   10 tasks → 1 subagent with 10 steps (sequential bottleneck)
❌ WRONG:   10 tasks → 10 subagents spawned one-by-one in separate turns (too slow)
❌ WRONG:   10 tasks → main agent does them all (defeats parallelism)
```

## When to Parallelize (default: always)

Split into parallel subagents for ANY of these patterns:
- **Multiple files to read/edit**: Refactor auth, api, db modules
- **Research + implementation**: Explore codebase while writing plan
- **Code + tests + docs**: Implement feature, write tests, update docs — all at once
- **Multi-directory exploration**: Explore frontend/, backend/, infra/ simultaneously
- **Review + fix**: Code review agent + fix agent run together
- **Multiple bugs to fix**: 5 bugs → 5 subagents, one per bug
- **Multiple competitors / items**: Research 5 libs in parallel, one agent each

## How to Spawn the Swarm

### Orchestrator-level (main session)
Use the `Agent` tool with `run_in_background: true` for each task:

```
Agent 1: "Implement User Repository"           → coder-workflow:code-implementer (background)
Agent 2: "Implement Auth Service"               → coder-workflow:code-implementer (background)
Agent 3: "Write tests for User module"          → coder-workflow:test-engineer (background)
Agent 4: "Update API docs for User endpoints"   → coder-workflow:docs-engineer (background)
```

**CRITICAL**: You MUST issue all `Agent` tool calls CONCURRENTLY in a SINGLE response. 
Do NOT spawn them sequentially one-by-one across multiple turns. Use multiple concurrent tool calls at once.
Use `run_in_background: true` for each.
**NO WORKTREES**: Never use `isolation: worktree` or branched workspaces. All agents must run in the exact same workspace environment.

### Subagent-level (inside a worker)
A subagent that needs help from another specialist uses `invoke_subagent` and **waits** for the result. This is for depth-2 delegation, NOT for spawning parallel work.

### Predefined Agent Roles

Use these specialist roles when relevant — each role handles **exactly 1 task**:
- **explorer** — use `coder-workflow:explore-codebase` agent for Graph-based MCP tools-first codebase exploration (replaces built-in Explore agent)
- **implementer** — writes or edits code (1 task per implementer)
- **test-writer** — writes unit/integration tests for changed code
- **docs-updater** — updates README, inline docs, or API docs
- **reviewer** — reviews code for quality, bugs, security issues
- **researcher** — searches web or reads files for context/best practices

## Dependency Rules

Only serialize when there is a hard data dependency:

✅ **Fully parallel (spawn all at once):**
- Writing to entirely different files/modules
- Independent research tasks
- Reading different files
- Tests + docs (after implementation spec is known)

✅ **Parallel with FILE_MANIFEST conflict detection:**
- Two agents may touch the same file → Each declares FILE_MANIFEST upfront
- Orchestrator collects manifests BEFORE spawning to detect conflicts
- If no overlap in write targets → spawn in parallel

❌ **Must serialize (spawn sequentially):**
- Agent B literally needs Agent A's output as its starting point
- Writing to the same file (merge conflicts expected)

When in doubt → parallelize with FILE_MANIFEST pre-check first. Only serialize when proven necessary.

## Default Decomposition → Swarm Patterns

- **"Explore this codebase"**
  Swarm: one agent per directory:
  - Agent 1: explore src/auth/
  - Agent 2: explore src/api/
  - Agent 3: explore src/db/
  - Agent 4: explore tests/
- **"Implement feature X across modules"**
  Swarm: one implementer per module:
  - Agent 1: implement user module
  - Agent 2: implement order module
  - Agent 3: implement payment module
  - Agent 4: write tests (parallel, based on spec)
  - Agent 5: update docs
- **"Fix bugs in multiple files"**
  Swarm: one agent per bug — all in parallel
- **"Research topic X"**
  Swarm: one agent per search angle

## Inter-Agent Communication (Swarm Chat)

When multiple agents are running in parallel, you can communicate with each other using the MCP Swarm Chat tools to share discoveries, coordinate changes, or resolve conflicts:
- Use your graph/mapping tools to broadcast to 'all' or a specific agent.
- Use your graph/mapping tools to check if other agents have sent you coordination messages.

## Synthesis

After all subagents complete:
1. Collect all outputs
2. Identify conflicts or overlaps (use FILE_MANIFEST to cross-check)
3. Resolve any merge conflicts
4. Present unified result to user

## Reminder
Never say "I'll do this one at a time." Never batch tasks into a single agent. **N tasks = N subagents.** This is the default behavior, not the exception.

---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**
