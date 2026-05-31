# Orchestration Guide

## Single-Agent Continual Flow

Every standard coding session follows this streamlined flow to prevent context degradation:

```
Request → workflow-planner (Decompose) → Sequential Implementation (Main Agent) → Targeted Verification → Impact Radius Quarantine
```

*Note: The `architecture-auditor` and `test-engineer` are invoked as sub-agents ONLY when explicitly required by the user or when the task demands strict external validation.*

## Agent Input Templates

### workflow-planner

```
Decompose this request into Atomic Committable Units:
- Goal: [one sentence]
- Relevant files: [list from codegraph MCP]
- Framework: [detected]
- Expected output: [what success looks like]
```

### architecture-auditor (Only when requested)

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
2. Use context7 MCP to query docs or `mcp__codegraph__search_code` to find internal patterns.
3. Read docs, understand pattern.
4. Implement based on evidence, not memory.
