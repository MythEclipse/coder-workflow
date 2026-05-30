#!/usr/bin/env bash
# session-banner.sh — printed on every fresh SessionStart (startup)
set -euo pipefail

R='\033[0m'
B='\033[1m'
DIM='\033[2m'
C='\033[36m'
Y='\033[33m'
G='\033[32m'
RED='\033[31m'

printf "${B}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n"
printf "${B}${C}  coder-workflow  ·  graph-first coding engine     ${R}\n"
printf "${B}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n"
printf "${DIM}Orchestrate${R}  /coder-workflow:coder-orchestrator\n"
printf "${DIM}Plan        ${R}  /coder-workflow:plan\n"
printf "${DIM}Audit       ${R}  /coder-workflow:audit\n"
printf "${DIM}Refactor    ${R}  /coder-workflow:refraktor\n"
printf "${B}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n"

# CodeGraph DB status
DB=".codegraph/graph.db"
if [ -f "$DB" ]; then
  SIZE=$(du -sh "$DB" 2>/dev/null | cut -f1)
  # Get age in minutes — handle macOS vs Linux stat differences
  if stat --version >/dev/null 2>&1; then
    # GNU stat (Linux)
    MTIME=$(stat -c %Y "$DB" 2>/dev/null || echo 0)
  else
    # BSD stat (macOS)
    MTIME=$(stat -f %m "$DB" 2>/dev/null || echo 0)
  fi
  NOW=$(date +%s)
  AGE_MINS=$(( (NOW - MTIME) / 60 ))

  if [ "$AGE_MINS" -gt 120 ]; then
    printf "${Y}Graph  ⚠  DB ${SIZE} — ${AGE_MINS}m old. Refresh graph with scan_codebase MCP${R}\n"
  else
    printf "${G}Graph  ✔  DB ${SIZE} — ${AGE_MINS}m old${R}\n"
  fi
else
  printf "${RED}Graph  ✘  No .codegraph/graph.db found${R}\n"
  printf "${Y}       →  Run scan_codebase MCP tool to build it${R}\n"
fi

# Check if coder-workflow CLI is on PATH
if command -v coder-workflow >/dev/null 2>&1; then
  printf "${G}CLI    ✔  coder-workflow$(coder-workflow --version 2>/dev/null | head -1 | sed 's/.*v/ v/' || true)${R}\n"
else
  printf "${Y}CLI    ⚠  coder-workflow not on PATH — MCP may still work${R}\n"
fi

printf "${B}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n"
