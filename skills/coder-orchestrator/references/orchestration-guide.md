# Orchestration Guide

## Fixed Agent Sequence

Every coding session follows this sequence:

```
Request → workflow-planner → architecture-auditor → code-implementer → architecture-auditor → Bug Fix Phase
```

## CodeGraph-First Search Routing

| User Request Pattern | Target Skill | Why |
|---------------------|--------------|-----|
| "Scan the codebase" | `scan-codegraph` | Build/refresh graph |
| "What does this repo do?" | `scan-codegraph` → `analyze-codegraph` | Structure + architecture |
| "Where is X implemented?" | `query-codegraph` | Definition/reference lookup |
| "Who calls Y?" | `query-codegraph` | Caller analysis |
| "Find all references to Z" | `query-codegraph` | Reference search |
| "Search for 'TODO_AUTH'" | `query-codegraph` + text search | Literal/regex search |
| "Read these 10 files" | `batch-codegraph` | Parallel independent reads |
| "What's the architecture?" | `analyze-codegraph` | Architecture summary |
| "What breaks if I change X?" | `analyze-codegraph` (impact) | Blast radius |
| "Are there circular deps?" | `analyze-codegraph` (cycles) | Cycle detection |
| "What files are unused?" | `analyze-codegraph` (orphans) | Dead code identification |
| "Refactor to MVC" | `modular-mvc-refactor` → `refraktor` | Structural transformation |
| "Export a diagram" | `export-codegraph` | Static export |
| "Open the graph viewer" | `open-codegraph-ui` | Interactive UI |

### Decision Tree

```
User request
├── Graph missing/stale? → scan-codegraph first
├── Single known file? → Read directly (skip graph)
├── Exact text search? → query-codegraph + search_code
├── Relationship question? → query-codegraph
├── Architecture/impact/risk? → analyze-codegraph
├── Multiple independent ops? → batch-codegraph
├── Structural refactor? → modular-mvc-refactor
├── Static export? → export-codegraph
└── Interactive view? → open-codegraph-ui
```

### Fallback Order

1. **Graph tools** — `query_graph`, `search_code`, `analyze_impact`, etc.
2. **CLI tools** — `codegraph-mapper query`, `codegraph-mapper search`, etc.
3. **Fallback** — grep/find/Explore agents (only after graph/search cannot answer)

### Graph Before Grep

| Instead of | Use |
|-----------|-----|
| `grep -r "UserRepository" .` | `query_graph("UserRepository")` |
| `find . -name "*.route.ts"` | `query_graph("routes")` |
| `grep -r "import.*auth" .` | `query_graph("what imports auth")` |
| Explore agent for architecture | `analyze-codegraph` |

### Benchmark Flow

When first exploring a codebase:

1. `scan-codegraph` — build graph
2. `summarize_architecture` — get overview
3. `summarize_graph` — understand scale
4. `analyze_quality` — check for issues
5. Route subsequent work based on findings

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
