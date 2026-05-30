# Export CodeGraph — Reference Guide

## MCP Tools

| Tool | Description |
|------|-------------|
| `export_graph` | Export graph to various formats |

## Export Formats

### JSON
```bash
codegraph-mapper export json
```
- Full graph structure: nodes, edges, metadata
- Machine-readable for custom tooling
- Best for: scripts, API consumption, custom analysis

### Mermaid
```bash
codegraph-mapper export mermaid
```
- Markdown-friendly diagrams
- Renders in GitHub, GitLab, Obsidian
- Best for: small module-level views, documentation

### DOT/Graphviz
```bash
codegraph-mapper export dot
```
- Complex graph rendering
- Requires Graphviz for visualization
- Best for: large dependency graphs, complex layouts

### Markdown
```bash
codegraph-mapper export markdown
```
- Human-readable architecture documentation
- Best for: onboarding docs, architecture review, wikis

### HTML
```bash
codegraph-mapper export html
```
- Standalone interactive viewer
- Opens in browser, no server needed
- Best for: sharing with team members who don't have local UI

## Scoped Exports

For large codebases, export subsets:

| Scope | Use Case |
|-------|----------|
| One directory | Module-specific documentation |
| One module | Feature boundary documentation |
| Upstream/downstream of one node | Impact documentation |
| Entry-point flow | Request flow documentation |
| High-risk nodes only | Security/audit documentation |

## Output Location

Default: `.codegraph/exports/`

Files are named by format:
- `graph.json`
- `diagram.mmd`
- `dependencies.dot`
- `architecture.md`
- `viewer.html`

## Viewer/Tool Guide

| Format | How to View |
|--------|------------|
| Mermaid | GitHub markdown, GitLab, Mermaid Live Editor |
| DOT | `dot -Tpng dependencies.dot -o graph.png` |
| JSON | `jq`, custom scripts, API consumption |
| Markdown | Any markdown viewer, GitHub, docs site |
| HTML | Open directly in browser |

## Security Notes

- Exports are static — no server required after generation
- HTML viewer reads `.codegraph/graph.db` locally
- Do not upload exports to third-party renderers without explicit user approval
- Exports may contain file paths — review before sharing externally
