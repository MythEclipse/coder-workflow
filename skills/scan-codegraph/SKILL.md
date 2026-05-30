---
name: scan-codegraph
description: Build or refresh `.codegraph/graph.db` before broad codebase exploration, grep/find, architecture analysis, or dependency lookup. Use when graph is missing, stale, or user asks to scan/index/map project structure.
version: 0.2.0
---

# Scan CodeGraph

Build or refresh graph foundation for broad codebase exploration and project-structure mapping.

## Trigger

- Graph missing or stale
- User asks to scan, index, map project structure, understand this repo
- User wants to explore where logic lives or search the codebase for request handling
- Next step would be broad grep/find/Explore to search code relationships
- Exact literal text searches across codebase

## Do not use

- Single known file read: "open src/foo.ts"
- Single-file typo fix with no cross-file impact
- Configuration read: "what's in package.json"

## Workflow

1. Check `.claude/codegraph-mapper.local.md` for project settings. Use defaults if missing:
   - Languages: JavaScript, TypeScript, Python, Go, Rust, Java
   - Ignore: `node_modules`, `.git`, `dist`, `build`, `.next`, `vendor`, `.codegraph/cache`
   - Graph: `.codegraph/graph.db`

2. Use MCP tool `scan_codebase` if available.

3. If MCP unavailable, try fallbacks in order:
   ```bash
   coder-workflow scan || \
   npx coder-workflow scan || \
   npx codegraph-mapper scan || \
   node "$HOME/.claude/skills/coder-workflow/dist/cli.js" scan || \
   { echo "WARN: graph scan unavailable - using grep/find fallback"; false; }
   # Incremental update:
   coder-workflow update --incremental || npx coder-workflow update --incremental || true
   ```

4. Verify `.codegraph/graph.db` exists.

## Red flags

- Graph missing after scan attempt: check permissions, disk space, plugin root path
- Stale graph: user reports recent file changes not reflected; suggest rescan
- Ignore rules too broad: verify `.claude/codegraph-mapper.local.md` does not exclude source directories
- All fallbacks failed: proceed with grep/find as last resort, note the gap for user

## Output contract

```
CodeGraph updated: .codegraph/graph.db
Languages: typescript, python
Nodes: 1284
Edges: 3097
Skipped: node_modules, dist
```

Report: languages detected, node count, edge count, skipped paths. Next: `query-codegraph` to search/explore, `analyze-codegraph` for impact/architecture.
