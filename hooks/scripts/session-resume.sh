#!/usr/bin/env bash
# session-resume.sh — printed when resuming an existing session
set -euo pipefail

Y='\033[33m'
G='\033[32m'
C='\033[36m'
B='\033[1m'
R='\033[0m'

printf "${B}${C}↩  Session resumed — coder-workflow is active${R}\n"

DB=".codegraph/graph.db"
if [ -f "$DB" ]; then
  if stat --version >/dev/null 2>&1; then
    MTIME=$(stat -c %Y "$DB" 2>/dev/null || echo 0)
  else
    MTIME=$(stat -f %m "$DB" 2>/dev/null || echo 0)
  fi
  NOW=$(date +%s)
  AGE_MINS=$(( (NOW - MTIME) / 60 ))

  if [ "$AGE_MINS" -gt 60 ]; then
    printf "${Y}  ⚠  CodeGraph DB is ${AGE_MINS}m old — stale. Refresh before deep analysis:${R}\n"
    printf "${Y}     scan_codebase MCP${R}\n"
  else
    printf "${G}  ✔  CodeGraph DB is ${AGE_MINS}m old — recent${R}\n"
  fi
else
  printf "${Y}  ✘  No .codegraph/graph.db. Graph tools unavailable until you run:${R}\n"
  printf "${Y}     scan_codebase MCP${R}\n"
fi

printf "${Y}  →  Re-read active task state before next action. All bugs must be tracked.${R}\n"
