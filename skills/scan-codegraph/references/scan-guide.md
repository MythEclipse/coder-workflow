# Scan CodeGraph — Reference Guide

## CLI Commands

| Command | Description |
|---------|-------------|
| `codegraph-mapper scan` | Full scan — rebuilds `.codegraph/graph.db` from scratch |
| `codegraph-mapper update` | Incremental update — scans only changed files |
| `codegraph-mapper update --incremental` | Explicit incremental mode |

## MCP Tools

| Tool | Description |
|------|-------------|
| `scan_codebase` | Build or refresh graph via MCP |

## Settings

Load from `.claude/codegraph-mapper.local.md`. Defaults:

```yaml
languages: [javascript, typescript, python, go, rust, java, kotlin]
ignore: [node_modules, .git, dist, build, .next, vendor, .codegraph/cache]
graph: .codegraph/graph.db
```

## Supported Languages & Parsers

| Language | Extensions | What it extracts |
|----------|-----------|-----------------|
| JavaScript | `.js`, `.jsx` | Imports, exports, functions, classes, routes, components |
| TypeScript | `.ts`, `.tsx` | Imports, exports, functions, classes, interfaces, routes, components |
| Python | `.py` | Imports, functions, classes, decorators |
| Go | `.go` | Imports, functions, methods, structs, interfaces |
| Rust | `.rs` | Modules, imports, functions, structs, traits, impls |
| Java | `.java` | Imports, classes, methods, interfaces |
| Kotlin | `.kt` | Imports, classes, functions, objects |

## Edge Types Extracted

1. **Import edges** — `import`/`require`/`from` statements
2. **Call edges** — function/method invocations (second pass)
3. **Component usage** — JSX/component references (second pass)
4. **Route handlers** — HTTP route → handler mappings (second pass)
5. **Inheritance** — extends/implements relationships (second pass)

## When Graph Is Stale

Indicators:
- User reports recent file changes not reflected in analysis
- `find_orphans` or `find_cycles` returning unexpected results
- Analysis shows files that no longer exist

Fix: run `codegraph-mapper scan` for full rebuild or `codegraph-mapper update` for incremental.

## Performance Tips

- Use `update --incremental` for large codebases after small changes
- Adjust ignore rules in `.claude/codegraph-mapper.local.md` to skip generated/large directories
- Run scan once at session start, then rely on PostToolUse hook for auto-updates

## Hooks Integration

- **SessionStart**: auto-scan if graph missing
- **PostToolUse** (Write|Edit|NotebookEdit): auto-update after file changes
- **Stop**: auto-update before session ends
