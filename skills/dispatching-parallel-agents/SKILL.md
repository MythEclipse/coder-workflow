---
name: dispatching-parallel-agents
description: Instructs Claude Code to ALWAYS decompose tasks into parallel subagents whenever possible, regardless of token cost. Use this skill whenever working on any multi-file, multi-step, or multi-concern task in Claude Code.
---

# Parallel Subagents — Always On

## Core Directive

Token cost is not a constraint. Speed and parallelism are the priority. Whenever a task can be split into independent units of work, spawn multiple subagents in parallel using the Task tool. Do NOT work sequentially unless tasks have hard dependencies on each other.

## When to Parallelize (default: always)

Split into parallel subagents for ANY of these patterns:
- **Multiple files to read/edit**: Refactor auth, api, db modules
- **Research + implementation**: Explore codebase while writing plan
- **Code + tests + docs**: Implement feature, write tests, update docs — all at once
- **Multi-directory exploration**: Explore frontend/, backend/, infra/ simultaneously
- **Review + fix**: Code review agent + fix agent run together
- **Multiple competitors / items**: Research 5 libs in parallel, one agent each

## How to Spawn Parallel Subagents

### Basic parallel spawn
When the user gives a task, immediately decompose and spawn:
```
I'll break this into parallel tasks:

- Task 1: [description] → subagent A
- Task 2: [description] → subagent B  
- Task 3: [description] → subagent C

Starting all three simultaneously...
```

### Explicit Task tool usage
Use the Task tool to spawn agents. Example prompt structure:
```
"Use the Task tool to spawn N subagents in parallel.
Agent 1: [specific task]. Agent 2: [specific task].
Start all simultaneously. Synthesize results when done."
```

## Predefined Agent Roles

Use these specialist roles when relevant — run them in parallel:
- **explorer** — reads and maps codebase structure, finds relevant files
- **implementer** — writes or edits code
- **test-writer** — writes unit/integration tests for changed code
- **docs-updater** — updates README, inline docs, or API docs
- **reviewer** — reviews code for quality, bugs, security issues
- **researcher** — searches web or reads files for context/best practices

## Dependency Rules

Only serialize when there is a hard data dependency:

✅ **Parallelize:**
- Reading different files
- Writing to different files
- Independent research tasks
- Tests + docs (after implementation is scoped)

❌ **Must serialize:**
- Agent B needs Agent A's output as input
- Two agents writing to the same file simultaneously

When in doubt → parallelize first, merge results after.

## Default Decomposition Patterns

- **"Explore this codebase"**
  Spawn one agent per top-level directory or concern:
  - Agent 1: explore src/auth/
  - Agent 2: explore src/api/
  - Agent 3: explore src/db/
  - Agent 4: explore tests/
- **"Implement feature X"**
  - Agent 1: implement the feature
  - Agent 2: write tests (based on spec, not waiting for Agent 1)
  - Agent 3: update docs/changelog
- **"Fix bugs in multiple files"**
  - One agent per file or per bug — all in parallel
- **"Research topic X"**
  - Agent 1: search recent docs/articles
  - Agent 2: explore existing codebase for related patterns
  - Agent 3: check for prior art / similar implementations

## Synthesis

After all subagents complete:
1. Collect all summaries
2. Identify conflicts or overlaps
3. Present unified result to user
4. Ask if further parallel work is needed

## Reminder
Never say "I'll do this one at a time." Always ask: can this be parallelized? If yes → spawn subagents. This is the default behavior, not the exception.
