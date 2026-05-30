# Open CodeGraph UI — Reference Guide

## MCP Tools

| Tool | Description |
|------|-------------|
| `open_graph_ui` | Launch interactive UI and return URL |

## CLI Fallback

```bash
codegraph-mapper ui
```

## UI Capabilities

- **Node inspection**: file, module, class, function, method, component, route, handler
- **Search**: filter large graphs by name, type, or path
- **Navigation**: click nodes to expand dependencies
- **Edge details**: view relationship type, source location, confidence
- **Filtering**: show/hide edge types, limit by depth, isolate subgraphs

## Configuration

Settings from `.claude/codegraph-mapper.local.md` or environment:

```yaml
ui:
  port: 3737          # or CODEGRAPH_DEFAULT_UI_PORT env var
  host: localhost     # binds to localhost only
```

## Port Configuration

| Source | Priority |
|--------|----------|
| `.claude/codegraph-mapper.local.md` ui.port | 1st |
| `CODEGRAPH_DEFAULT_UI_PORT` env var | 2nd |
| Default fallback `3737` | 3rd |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port already in use | Check `lsof -i :3737` or `netstat -tlnp`, kill existing process or configure alternate port |
| Cannot connect | Verify server started — check terminal output for URL |
| Stale data shown | Refresh graph with `codegraph-mapper update` or `scan` |
| Graph missing | Run `codegraph-mapper scan` first to build `.codegraph/graph.db` |
| UI slow on large graphs | Use filtering to limit visible nodes, or export static HTML instead |

## When to Use UI vs Export

| Need | Tool |
|------|------|
| Interactive exploration | `open-codegraph-ui` |
| Shareable static file | `export-codegraph` (HTML) |
| Documentation/diagram | `export-codegraph` (Mermaid/DOT) |
| Machine processing | `export-codegraph` (JSON) |
