---
name: export-codegraph
description: Generate reusable graph outputs (Mermaid, DOT, JSON, Markdown, HTML) from `.codegraph/graph.db`. Use when user asks to export, visualize, or document graph data for sharing or external tools.
version: 0.2.0
---

# Export CodeGraph

**CORE RULE:** Static export only. No uploads to third-party renderers without explicit user approval.

## Trigger

- User asks to export, generate diagram, create visualization
- Need Mermaid for docs, DOT for Graphviz, JSON for tools
- Want standalone HTML viewer or Markdown documentation

## Do not use

- Graph missing (use `scan-codegraph` first)
- User wants interactive UI (use `open-codegraph-ui` instead)
- User hasn't approved third-party renderer uploads

## Workflow

1. Verify `.codegraph/graph.db` exists. If missing, use `scan-codegraph` first.

2. Use MCP tool `export_graph` if available.

3. Export requested formats only. Supported:
   - **JSON** — canonical graph data for tools
   - **Mermaid** — Markdown-friendly diagrams
   - **DOT/Graphviz** — large graph rendering
   - **Markdown** — architecture documentation
   - **HTML** — standalone interactive viewer

4. For large codebases, prefer scoped exports:
   - One directory
   - One module
   - Upstream/downstream neighborhood of one node
   - Entry-point flow
   - High-risk nodes only

5. Write exports to `.codegraph/exports/` by default.

6. Report created files and intended viewer/tool.

## Format choice

| Format | Best for | Viewer |
|--------|----------|--------|
| Mermaid | Small diagrams, module-level views, docs | Markdown, GitHub, GitLab |
| DOT | Large dependency graphs, complex layouts | Graphviz, online renderers |
| JSON | Machine processing, custom tools | Scripts, APIs |
| Markdown | Onboarding, architecture review | Docs, wikis |
| HTML | Shareable interactive output | Browser, no local UI needed |

## Red flags

- User requests upload to online renderer without explicit approval — ask first
- Export truncated or filtered — note in report
- Large codebase export — recommend scoped export instead

## Output contract

```
Exports written:
- .codegraph/exports/modules.mmd
- .codegraph/exports/dependencies.dot
- .codegraph/exports/architecture.md
```

Include: file paths, format, intended viewer/tool, truncation/scope notes.

