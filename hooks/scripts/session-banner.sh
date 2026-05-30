#!/usr/bin/env bash
# session-banner.sh — printed on every fresh SessionStart (startup)
set -euo pipefail

# Save stdout to descriptor 3, and redirect stdout to stderr
exec 3>&1
exec 1>&2

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
printf "${DIM}Graph setup ${R}  /coder-workflow:setup-codegraph\n"
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
    printf "${Y}Graph  ⚠  DB ${SIZE} — ${AGE_MINS}m old. Refresh: /coder-workflow:scan-codegraph${R}\n"
  else
    printf "${G}Graph  ✔  DB ${SIZE} — ${AGE_MINS}m old${R}\n"
  fi
else
  printf "${RED}Graph  ✘  No .codegraph/graph.db found${R}\n"
  printf "${Y}       →  Run /coder-workflow:setup-codegraph to build it${R}\n"
fi

# Check if coder-workflow CLI is on PATH
if command -v coder-workflow >/dev/null 2>&1; then
  printf "${G}CLI    ✔  coder-workflow$(coder-workflow --version 2>/dev/null | head -1 | sed 's/.*v/ v/' || true)${R}\n"
else
  printf "${Y}CLI    ⚠  coder-workflow not on PATH — MCP may still work${R}\n"
fi

printf "${B}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n"

# Restore stdout and return hookSpecificOutput JSON
exec 1>&3
printf "{\"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"[MANDATORY LOAD RULE]\\\\nYou are coder-workflow, an orchestrator-driven coding engine.\\\\n\\\\nAt the start of the session, you MUST immediately load and invoke the 'coder-orchestrator' skill (Namespace: /coder-workflow:coder-orchestrator) before taking any other action or responding. This skill dictates how to plan, audit, refactor, and implement coding tasks. Do not attempt to run tools or answer without /coder-workflow:coder-orchestrator loaded.\\\\n\\\\nViolating this rule is strictly prohibited.\"}}\n"
