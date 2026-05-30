---
name: open-codegraph-ui
description: Launch interactive CodeGraph UI for visual codebase exploration. Use when user asks to open graph UI, visualize dependencies, or explore graph interactively. Requires `.codegraph/graph.db` to exist.
version: 0.2.0
---

# Open CodeGraph UI

**CORE RULE:** Graph must exist and be current. UI is local browser exploration only.

## Trigger

- User asks to open/launch graph UI, visualize dependencies
- Want interactive search, filtering, node details
- Graph data exists and is current

## Do not use

- Graph missing (use `scan-codegraph` first)
- User wants static export (use `export-codegraph` instead)
- Graph is stale (refresh with `scan-codegraph` first)

## Workflow

1. Verify `.codegraph/graph.db` exists. If missing, use `scan-codegraph` first.

2. Use MCP tool `open_graph_ui` if available.

3. If MCP unavailable, run CLI:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js ui
   ```

4. Report local URL returned by tool or command.

5. Tell user UI reads `.codegraph/graph.db` through local server and reflects latest scanned data.

## UI capabilities

- Inspect file, module, class, function, method, component, route, handler nodes
- Search and filter large graphs
- View node details: path, language, inbound/outbound edges, relationship evidence
- Navigate dependencies interactively

## Troubleshooting

- **Stale data:** Refresh graph with `scan-codegraph`
- **Cannot connect:** Check configured port available. Default from `.claude/codegraph-mapper.local.md` or `CODEGRAPH_DEFAULT_UI_PORT`, fallback to `3737`
- **Port conflict:** UI may fail if port already in use; check running processes or configure alternate port
- **Graph missing:** Error on startup means `.codegraph/graph.db` doesn't exist; run `scan-codegraph` first

## Output contract

Report: local URL, port, graph freshness status, and any connection issues. Confirm UI is accessible before closing.

