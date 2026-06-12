# MCP Server

The plugin includes a CodeGraph MCP server accessible via `coder-workflow mcp`. Configure via `.mcp.json` for graph-first code intelligence.

## Exposed Tools

| Tool | Purpose |
|------|---------|
| `scan_codebase` | Build or refresh graph |
| `query_graph` | Search definitions, references, callers, dependencies |
| `analyze_impact` | Upstream/downstream impact analysis |
| `analyze_quality` | Codebase graph quality checks |
| `search_code` | Regex/literal source text search (multi-pattern batch) |
| `find_cycles` | Circular dependency detection |
| `find_orphans` | Unreferenced files/symbols |
| `summarize_architecture` | Entry points, modules, dependencies, hotspots |
| `export_graph` | JSON, Mermaid, DOT, Markdown, HTML export |
| `quality_gate` | Quality gate evaluation against threshold |
| `read_file` | Read file contents |
| `list_directory_tree` | Project directory structure visualization |

## Configuration

Configure MCP servers via `.mcp.json` at plugin root:

```json
{
  "mcpServers": {
    "coder-workflow-mcp": {
      "command": "coder-workflow",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

## CLI Usage

```bash
# Start MCP server directly
coder-workflow mcp

# Scan codebase
npm run scan

# Open graph UI
npm run ui
```
