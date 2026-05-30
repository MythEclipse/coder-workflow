---
name: batch-codegraph
description: Execute multiple read, search, or query operations in parallel. Use when user asks for many reads, searches, or mixed lookups at once. Batch tools handle up to 50 items with bounded concurrency and per-item success/failure tracking. Skip for single operations or when graph is missing.
version: 0.1.0
---

# Batch Operations

Parallelize independent read, search, and query operations with bounded concurrency and per-item tracking.

## CORE RULE

Batch only independent operations; do not batch dependent reads/searches. If operation B needs result from operation A, run A first, then B. Batch is for "read these 5 files" or "search for these 3 patterns" — not for "read A, then based on A's result read B."

## Trigger

**Use this skill when:**
- User asks for many reads, searches, or mixed lookups at once
- Need to parallelize independent operations across files
- Operations have no dependencies on each other
- Recon phase needs to scan multiple files or patterns simultaneously

**Examples:**
- "read these 5 files"
- "search for TODO, FIXME, BUG in parallel"
- "find all references to these 3 functions"
- "check these 4 modules for layer violations"

## Do not use

- Do not batch dependent operations (A's result feeds into B)
- Do not batch single operations (use individual tools instead)
- Do not batch if you need to inspect results mid-batch to decide next steps

## Workflow

1. Identify operation type: read files, search code, or mixed.

2. Collect items into batch request. Verify all operations are independent.

3. Use Agent tool with multiple subagents for parallel work, or use parallel Bash/read operations:
   - Multiple `Read` calls for file content
   - Multiple `Grep`/`Glob` calls for pattern searches
   - Multiple `mcp__codegraph__query_graph` calls for graph queries

4. Parse results: check each operation succeeded or failed.

5. Report results grouped by success/failure, cite paths and symbols precisely.

## Usage patterns

**Parallel file reads:**
```
Read multiple files simultaneously to understand project structure.
```

**Parallel pattern searches:**
```
Search for multiple patterns at once: "TODO", "FIXME", "HACK", "XXX" across the codebase.
```

**Parallel module audits:**
```
Check multiple modules for the same violation: ORM calls in controllers across all modules.
```

## Red flags

- Operation B depends on result from operation A: run A first, then B
- Single operation: use individual tool instead
- Need to inspect mid-batch: run in stages instead
- Partial failures: check per-item status and errors before proceeding

## Output contract

- Total items, succeeded count, failed count
- Per-item results with file path and result or error
- Group results by success/failure for clarity
- Cite file paths and symbols precisely
