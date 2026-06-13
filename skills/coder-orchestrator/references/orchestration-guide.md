# Orchestration Guide

## Swarm Dispatch Flow

Every standard coding session follows this parallel-first flow:

```
Request → built-in planner (Decompose into N tasks) → Swarm Dispatch (N subagents) → Synthesis → Verification → Bug Fix Phase
```

The key architectural shift: **1 task = 1 subagent**. After planning produces N atomic tasks, the orchestrator spawns N subagents simultaneously — each receiving exactly one task with clear boundaries. No single agent handles multiple tasks.

### Flow Steps

1. **Decompose** → built-in planner (with `workflow-planner` skill) breaks request into N Atomic Committable Units
2. **Swarm** → Orchestrator spawns N subagents using `Agent` tool with `run_in_background: true`
   - Each subagent declares FILE_MANIFEST before execution
   - Orchestrator cross-checks manifests for write conflicts before dispatch
3. **Execute** → All N subagents run in parallel; each handles exactly 1 task
4. **Synthesis** → Orchestrator collects results, resolves conflicts, merges
5. **Verify** → Targeted verification on changed files
6. **Bug Fix** → Fix discovered bugs (each bug = 1 subagent task)

*Architecture-auditor and coder-workflow:test-engineer are invoked as swarm members when the decomposition calls for them.*

## Agent Input Templates

### built-in planner (with workflow-planner skill)

```
Decompose this request into Atomic Committable Units:
- Goal: [one sentence]
- Relevant files: [list from Graph-based MCP tools]
- Framework: [detected]
- Expected output: [what success looks like]
```

### coder-workflow:architecture-auditor (Only when requested)

```
Audit this scope for layer violations:
- Scope: [path or module]
- Framework: [detected]
- File targets: [list from codegraph]
```

## Impact Radius Bug Discovery Protocol

1. **During Implementation**:
   - Track any bugs/warnings encountered in the files you are actively modifying.
   - Ignore background noise from unrelated legacy modules.

2. **Verification Phase**:
   - Run **targeted** checks on your modified files (e.g., `npx tsc --noEmit specific_file.ts`).
   - Fix all bugs inside your **Impact Radius** (the files you touched).
   - If a change cascades and breaks a dependent file, that file enters your Impact Radius. You must fix the breakage.
   - Document any pre-existing technical debt found outside your radius, but DO NOT attempt to fix it.

## Task Granularity Guide (Feature Slices)

| Too Fragmented (Avoid) | Right Size (Atomic Committable Unit) |
|-------------------------|--------------------------------------|
| "Create User interface" | "Build User Schema & Repository" |
| "Add getUser method"    | "Build User Service layer (CRUD)" |
| "Add POST route"        | "Build User Controller & HTTP Routes" |

## Research Protocol

When encountering unfamiliar territory:
1. Stop implementation.
2. Use context7 MCP to query docs or graph/mapping tools (multi-pattern batch `patterns: [...]`) to find internal patterns.
3. Read docs, understand pattern.
4. Implement based on evidence, not memory.

---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**

