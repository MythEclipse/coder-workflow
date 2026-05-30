# Orchestration Guide

## Fixed Agent Sequence

Every coding session follows this sequence:

```
Request → workflow-planner → architecture-auditor → code-implementer → architecture-auditor → Bug Fix Phase
```

## Agent Input Templates

### workflow-planner

```
Decompose this request into small tracked tasks:
- Goal: [one sentence]
- Relevant files: [list from codegraph MCP]
- Framework: [detected]
- Constraints: [user requirements]
- Expected output: [what success looks like]
```

### architecture-auditor (pre-audit)

```
Audit this scope for layer violations:
- Scope: [path or module]
- Framework: [detected]
- Violation types to check: [list from violation table]
- File targets: [list from codegraph]
```

### code-implementer

```
Implement this plan:
- Plan: [approved plan reference]
- File targets: [list with line numbers]
- Verification commands: [typecheck, lint, test]
- Constraints: [what NOT to change]
- Agent type: code-implementer
```

### architecture-auditor (post-verify)

```
Verify no new violations were introduced:
- Scope: [same as pre-audit]
- Pre-audit findings: [list]
- Changed files: [list from git diff]
- Compare: any new violations since pre-audit?
```

## Bug Discovery Protocol

1. During any phase, if a bug/warning/error is found:
   - Create TaskCreate with severity + description + file:line
   - Note in "Discovered Bugs" section
   - Continue primary work — do NOT context-switch

2. After ALL primary tasks complete:
   - List all discovered bugs
   - Fix in order: Blocker → High → Medium
   - Verify each fix independently
   - Session NOT complete until all High/Medium fixed

## Task Granularity Guide

| Too Big | Right Size |
|---------|-----------|
| "Add auth system" | "Add password hashing utility function" |
| "Fix all bugs" | "Fix null pointer in getUser service method" |
| "Refactor user module" | "Extract ORM calls from userController to userRepository" |
| "Write tests" | "Write unit test for createUser service method" |
| "Update routes" | "Add POST /users route declaration" |

## Research Protocol

When encountering unfamiliar territory:
1. Stop implementation
2. Use context7 MCP: `mcp__plugin_context7_context7__resolve-library-id` → `mcp__plugin_context7_context7__query-docs`
3. Read docs, understand pattern
4. Implement based on docs, not memory
5. Store learning for future sessions
