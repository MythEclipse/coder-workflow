# ANALISIS KOMPREHENSIF: ALUR MCP, CLI, DAN EVALUASI KELEMAHAN SISTEMIK
**Coder-Workflow v0.3.0** | Tanggal: 2026-06-03 | Status: In-Depth Architecture Review

---

## EXECUTIVE SUMMARY

Coder-Workflow adalah plugin AI CLI yang mengorkestra pekerjaan coding melalui:
- **Single Orchestrator Entry Point** (`coder-orchestrator` skill)
- **Task Decomposition** dengan workflow-planner dan parallel subagents
- **CodeGraph MCP Server** untuk analisis codebase graph-first
- **Hook System** yang ekstensif untuk safety guards dan lifecycle management

### Temuan Utama
✅ **Strengths**: Arsitektur modular, hook coverage komprehensif, MCP integration yang solid
⚠️ **Weaknesses**: Context token efficiency, error recovery, async hook coordination
🔴 **Critical Issues**: 3 bottleneck utama teridentifikasi dalam alur MCP→CLI

---

## 1. ARSITEKTUR SISTEM — OVERVIEW

### 1.1 Komponen Utama

```
┌─────────────────────────────────────────────────────────────┐
│                     AI CLI SESSION (User)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Plugin Discovery & Loading                     │
│  (~/.claude/skills/coder-workflow)                          │
│  ├─ skills/                (Meta-orchestrators)             │
│  ├─ agents/                (Specialized engineers)          │
│  ├─ commands/              (Slash command mappers)          │
│  ├─ hooks/                 (Lifecycle & safety guards)      │
│  └─ .claude-plugin/        (Plugin metadata)                │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  SKILL       │ │  AGENT       │ │  MCP SERVER  │
│  (Meta)      │ │  (Executor)  │ │  (Graph)     │
│              │ │              │ │              │
│ coder-       │ │ workflow-    │ │ codegraph-   │
│ orchestrator │ │ planner      │ │ mapper       │
│              │ │ code-        │ │              │
│ brainstorming│ │ implementer  │ │ .mcp.json    │
│              │ │ testing-eng  │ │ (config)     │
│ dispatching- │ │ refactoring- │ │              │
│ parallel     │ │ engineer     │ │ Tools:       │
│              │ │ debugging-   │ │ - scan       │
│              │ │ engineer     │ │ - query      │
│              │ │ ui-engineer  │ │ - analyze    │
│              │ │ db-architect │ │ - export     │
│              │ │ devops-eng   │ │ - find-*     │
│              │ │ code-reviewer│ │              │
│              │ │ docs-engineer│ │              │
│              │ │ multi-repo   │ │              │
│              │ │ orchestrator │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ CLI          │ │ HOOKS        │ │ CODEGRAPH    │
│              │ │              │ │ DATABASE     │
│ Subcommands: │ │ PreToolUse   │ │              │
│ - scan       │ │ PostToolUse  │ │ .codegraph/  │
│ - query      │ │ SessionStart │ │ graph.db     │
│ - impact     │ │ Stop         │ │ (libSQL)     │
│ - export     │ │ FileChanged  │ │              │
│ - ui         │ │ CwdChanged   │ │ Schema:      │
│ - dashboard  │ │ SubagentStart│ │ - nodes      │
│              │ │ TaskCreated  │ │ - edges      │
│              │ │ SessionEnd   │ │ - metadata   │
│              │ │              │ │ - scan cache │
└──────────────┘ └──────────────┘ └──────────────┘
```

### 1.2 Lokasi File Kritis

```
coder-workflow/
├── src/
│   ├── cli.ts                    (Entry: subcommand router)
│   ├── mcp-server.ts             (MCP server entry)
│   ├── graph.ts                  (Scan + graph ops)
│   ├── graph/db.ts               (libSQL wrapper - HOTSPOT, degree 46)
│   ├── analysis/
│   │   ├── query.ts              (Graph query engine)
│   │   ├── impact.ts             (Upstream/downstream traversal)
│   │   ├── quality.ts            (Quality gate + analysis)
│   │   └── summary.ts            (Architecture summarization)
│   ├── search.ts                 (Code search - HOTSPOT, degree 36)
│   └── exporters.ts              (JSON/Mermaid/HTML export)
├── skills/
│   ├── coder-orchestrator/SKILL.md       (Meta-skill, 150 lines)
│   ├── brainstorming/SKILL.md
│   ├── dispatching-parallel-agents/SKILL.md
│   └── writing-skills/SKILL.md
├── agents/
│   ├── workflow-planner.md       (Task decomposition)
│   ├── architecture-auditor.md
│   ├── code-implementer.md
│   ├── debugging-engineer.md
│   ├── test-engineer.md
│   ├── refactoring-engineer.md
│   ├── ui-engineer.md
│   ├── db-architect.md
│   ├── code-reviewer.md
│   ├── devops-engineer.md
│   ├── docs-engineer.md
│   ├── todo-checker.md
│   ├── diagram-engineer.md
│   └── multi-repo-orchestrator.md
├── hooks/
│   ├── hooks.json                (91 hook definitions)
│   └── scripts/
│       ├── session-banner.sh
│       ├── session-resume.sh
│       ├── rm-guard.sh
│       ├── force-push-guard.sh
│       ├── env-write-guard.sh
│       ├── task-force-subagent.sh
│       └── session-metrics.sh
├── commands/
│   └── (Slash command definitions)
├── .mcp.json                     (MCP server config)
├── CLAUDE.md                     (Project instructions)
└── package.json
```

### 1.3 Quality Metrics (CodeGraph)

| Metric | Value | Status |
|--------|-------|--------|
| Files Scanned | 61 | ✅ Complete |
| Nodes | 399 | ✅ Healthy |
| Edges | 801 | ✅ Coverage: 100% |
| Orphan Files | 0 | ✅ No dead code |
| Cycles | 0 | ✅ No circular deps |
| Quality Score | 0.973 | ✅ Excellent |
| Type Coverage | 100% (TypeScript) | ✅ Pass |
| Languages | TS, JS, Python | ✅ Multi-lang support |

---

## 2. ALUR KERJA UTAMA: USER INPUT → ORCHESTRATOR → SKILL → AGENT → MCP

### 2.1 Request Flow Diagram

```
┌──────────────────────────────┐
│ User Command                 │
│ (e.g., "implement feature") │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ PRE-SUBMISSION HOOK: UserPromptSubmit            │
│ ├─ session-context (detect skills)              │
│ └─ async log to .claude/session-*.log           │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ SESSION START HOOK (if first turn)               │
│ ├─ session-banner.sh (graph status)             │
│ ├─ Auto-scan if no .codegraph/graph.db          │
│ └─ Check freshness (age, staleness)             │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ SKILL INVOCATION (coder-orchestrator)            │
│ ├─ Parse: "might any subagent apply?"          │
│ ├─ Route to specialist (planner, implementer)   │
│ └─ Enforce subagent-first mandate               │
└──────────────┬───────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌──────────────┐  ┌──────────────────────┐
│ FAST PATH    │  │ COMPLEX PATH         │
│ (Trivial)    │  │ (Multi-step)         │
│              │  │                      │
│ Direct →     │  │ 1. workflow-planner  │
│ code-impl    │  │    (decompose)       │
│              │  │ 2. Parallel agents   │
│              │  │    (execute)         │
│              │  │ 3. code-reviewer     │
│              │  │    (audit)           │
└──────┬───────┘  └──────────┬───────────┘
       │                     │
       └──────────┬──────────┘
                  ▼
┌──────────────────────────────────────────────────┐
│ AGENT EXECUTION (subagent spawned)               │
│ ├─ Read codebase (via mcp__codegraph tools)     │
│ ├─ Implement/fix/test/refactor                  │
│ ├─ Track: .claude/agent-depth.lock              │
│ └─ Report: structured output or JSON            │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ MCP TOOL CALLS (Inside Agent Context)            │
│ ├─ mcp__codegraph__scan_codebase()              │
│ ├─ mcp__codegraph__query_graph()                │
│ ├─ mcp__codegraph__analyze_impact()             │
│ ├─ mcp__codegraph__find_cycles()                │
│ ├─ mcp__codegraph__export_graph()               │
│ └─ mcp__codegraph__analyze_quality()            │
└──────────────┬───────────────────────────────────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
┌─────────────┐  ┌──────────────────────┐
│ CodeGraph   │  │ File I/O + Read      │
│ MCP Server  │  │ ├─ mcp__ide__*       │
│ (stdio)     │  │ ├─ Read tool         │
│ ├─ Query DB │  │ ├─ Bash tool         │
│ ├─ Analyze  │  │ └─ Write/Edit tools  │
│ └─ Export   │  └──────────────────────┘
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│ POST-TOOL HOOKS (Auto-Triggered)                 │
│ ├─ Write/Edit detected                          │
│ ├─ Async: coder-workflow update (graph refresh) │
│ ├─ Log to .claude/session-*.log                 │
│ └─ Git operations trigger graph rebuild         │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ SESSION STOP HOOK (Auto-Commit + Graph Update)   │
│ ├─ git add . + auto-commit message              │
│ ├─ coder-workflow update (final graph sync)     │
│ └─ Session metrics to .claude/session-*.log     │
└──────────────────────────────────────────────────┘
```

