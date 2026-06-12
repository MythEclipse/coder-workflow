# Development Commands

## Install & Build

```bash
# Install dependencies + build + global CLI + MCP config
./install.sh

# Build TypeScript
npm run build

# Typecheck
npm run typecheck

# Run tests
npm run test
```

## MCP & Graph

```bash
# Start MCP server directly
npm run start:mcp

# Scan codebase
npm run scan

# Open graph UI
npm run ui
```

## Lint & Format

```bash
npm run lint
npm run check
```

## Verify Plugin Structure

```bash
ls skills/ agents/ commands/ hooks/ dist/ src/
```

## Test Install

```bash
# Test install to current project
./install.sh --project --link

# Test with --plugin-dir (no install needed)
claude --plugin-dir /mnt/code/djnaidwhbwda/coder-workflow
```
