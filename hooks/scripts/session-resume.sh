#!/usr/bin/env bash
# session-resume.sh — printed when resuming an existing session
# Also checks for crash recovery: in-progress tasks, stale lock files, deferred bugs
set -euo pipefail

# Save stdout to descriptor 3, and redirect stdout to stderr
exec 3>&1
exec 1>&2

Y='\033[33m'
G='\033[32m'
C='\033[36m'
R='\033[0m'
B='\033[1m'
RED='\033[31m'

printf "${B}${C}↩  Session resumed — coder-workflow is active${R}\n"

DB=".codegraph/graph.json"
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
    printf "${Y}     /coder-workflow:scan-codegraph${R}\n"
  else
    printf "${G}  ✔  CodeGraph DB is ${AGE_MINS}m old — recent${R}\n"
  fi
else
  printf "${Y}  ✘  No .codegraph/graph.json. Graph tools unavailable until you run:${R}\n"
  printf "${Y}     /coder-workflow:setup-codegraph${R}\n"
fi

# ============================================================
# Crash Recovery Detection
# ============================================================
RECOVERY_NOTES=""

# 1. Check for stale agent depth lock (subagent crashed without cleanup)
LOCK_FILE=".claude/agent-depth.lock"
if [ -f "$LOCK_FILE" ]; then
  STALE_DEPTH=$(cat "$LOCK_FILE" 2>/dev/null | grep -E '^[0-9]+$' || echo 0)
  if [ "$STALE_DEPTH" -gt 0 ]; then
    RECOVERY_NOTES="${RECOVERY_NOTES}⚠ CRASH RECOVERY: Stale agent-depth lock detected (depth=${STALE_DEPTH}). A subagent may have crashed without cleanup. Resetting lock.\n"
    rm -f "$LOCK_FILE" 2>/dev/null || true
    rm -f "${LOCK_FILE}.flock" 2>/dev/null || true
  fi
fi

# 2. Check for in-progress task.md checklist
if [ -f "task.md" ]; then
  IN_PROGRESS=$(grep -c "\[ \]" "task.md" 2>/dev/null || echo 0)
  DONE_COUNT=$(grep -c "\[x\]" "task.md" 2>/dev/null || echo 0)
  if [ "$IN_PROGRESS" -gt 0 ] || [ "$DONE_COUNT" -gt 0 ]; then
    RECOVERY_NOTES="${RECOVERY_NOTES}⚠ CRASH RECOVERY: Found task.md checklist ($DONE_COUNT done, $IN_PROGRESS remaining). Read it to resume from where you left off.\n"
  fi
fi

# 3. Check for deferred bugs from prior session
if [ -f ".claude/deferred-bugs.json" ]; then
  DEFERRED_COUNT=$(jq 'length' ".claude/deferred-bugs.json" 2>/dev/null || echo 0)
  if [ "$DEFERRED_COUNT" -gt 0 ]; then
    RECOVERY_NOTES="${RECOVERY_NOTES}⚠ DEFERRED BUGS: $DEFERRED_COUNT bug(s) deferred from prior session in .claude/deferred-bugs.json. Review and fix before new work.\n"
  fi
fi

# 4. Check for stale task state (task.md exists but no active session tasks)
if [ -f "task.md" ]; then
  TASK_MD_MTIME=$(stat -c %Y "task.md" 2>/dev/null || stat -f %m "task.md" 2>/dev/null || echo 0)
  TASK_AGE_HOURS=$(( (NOW - TASK_MD_MTIME) / 3600 ))
  if [ "$TASK_AGE_HOURS" -gt 24 ]; then
    RECOVERY_NOTES="${RECOVERY_NOTES}⚠ STALE CHECKLIST: task.md is ${TASK_AGE_HOURS}h old. Verify if it's still relevant.\n"
  fi
fi

if [ -n "$RECOVERY_NOTES" ]; then
  printf "${RED}${RECOVERY_NOTES}${R}\n"
fi

printf "${Y}  →  Re-read active task state before next action. All bugs must be tracked.${R}\n"

# Build additional context with crash recovery info
ADDITIONAL_CONTEXT="[MANDATORY LOAD RULE]\\nYou are coder-workflow, an orchestrator-driven coding engine.\\n\\nUpon session resume, you MUST immediately load and invoke the 'coder-orchestrator' skill (Namespace: /coder-workflow:coder-orchestrator) before taking any other action or responding. This skill dictates how to plan, audit, refactor, and implement coding tasks. Do not attempt to run tools or answer without /coder-workflow:coder-orchestrator loaded.\\n\\nCRASH RECOVERY CHECKLIST:\\n1. Check if task.md exists — if so, read it and resume from the last unchecked item.\\n2. Check for in_progress tasks via TaskList — mark them appropriately (completed if done, or resume if interrupted).\\n3. Check .claude/deferred-bugs.json — review and fix any deferred bugs from prior session.\\n4. Check .claude/agent-depth.lock — if it exists with depth > 0, a subagent crashed. Delete the lock file.\\n5. Verify graph freshness before deep analysis.\\n\\nViolating this rule is strictly prohibited."

# Restore stdout and return hookSpecificOutput JSON
exec 1>&3
printf "{\"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"%s\"}}\n" "$ADDITIONAL_CONTEXT"
