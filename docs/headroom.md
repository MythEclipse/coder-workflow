# Headroom Features (Context Optimization)

This plugin is equipped with Headroom-inspired context compression and memory features.

## 1. CCR — Reversible Context Compression

Compress tool outputs, code, JSON, and prose by 60-95% before sending to LLM. Originals stored locally in `.claude/ccr/` and retrievable on demand.

**MCP Tools:** `compress_content`, `decompress_content`, `ccr_stats`, `clean_ccr`
**CLI:** `coder-workflow compress [--json|--code|--prose]`, `coder-workflow decompress <ccr-id>`
**Aliases:** `ccr-stats`, `ccr-clean`

### Architecture

- **SmartCrusher** — JSON compressor: schema extraction + key shortening for arrays of objects, nested objects
- **CodeCompressor** — AST-aware code compression: strip comments, collapse blanks, truncate long identifiers
- **Prose Compressor** — Log/tool output: collapse to head+tail, truncate with line count

## 2. CacheAligner — KV Cache Optimization

Standardize prefixes of prompts and system messages so that Anthropic/OpenAI provider-side KV caching hits more frequently.

**MCP Tools:** `align_cache`, `cache_alignment_stats`
**CLI:** `coder-workflow align-cache [--type system|agent|skill] [--sub-type <name>]`

Stable prefixes registered for all agent types (implementer, auditor, debugger, reviewer, tester, ui, db, deploy, docs) and skills (orchestrator, plan, brainstorm).

## 3. Learn — Self-Improving Failure Analysis

Every tool failure and stop failure is logged via hooks. On demand, the system analyzes failure patterns and auto-generates corrections written to `.claude/learn/memory/`.

**MCP Tools:** `analyze_failures`, `learn_report`, `log_failure`, `resolve_failure`, `match_correction`
**CLI:** `coder-workflow learn-analyze [--apply]`, `learn-report`, `learn-log`, `learn-resolve`, `learn-match`

### Hook Integration

- `StopFailure` — auto-logs rate_limit, max_output_tokens, server errors via `learn-log`
- `PostToolUseFailure` — auto-logs all tool failures with tool name + error

## 4. Cross-Agent Memory — Multi-Platform Memory Store

Platform-agnostic memory format readable by Claude, Codex, Gemini, and Cursor. Entries stored in `.claude/cross-agent-memory/` with YAML frontmatter and agent provenance tracking.

**MCP Tools:** `store_memory`, `query_memory`, `memory_stats`, `export_memory_markdown`, `sync_memory_platform`, `supported_platforms`
**CLI:** `coder-workflow memory-store [--name <slug> --description <text> --content <text> --agent <name>]`, `memory-query`, `memory-stats`, `memory-export`, `memory-sync`, `memory-platforms`

### Features

- Auto-deduplication by content hash
- Platform-agnostic Markdown export for non-Claude agents
- YAML export for CI/CD pipelines
- Cross-platform sync via directory-based import

## Quick Start

```bash
# Compress any content
echo '{"data": "very long json ..."}' | coder-workflow compress --json

# Decompress a CCR entry
coder-workflow decompress a1b2c3d4e5f6-prose

# Analyze failures and apply corrections
coder-workflow learn-analyze --apply

# Store a cross-agent memory
coder-workflow memory-store --name "bug-fix-pattern" --description "How to fix X" --content "Fix steps..." --agent "alice"

# Align content for cache (pipe through before sending to LLM)
echo "Your agent prompt here" | coder-workflow align-cache --type agent --sub-type implementer
```
