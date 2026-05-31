#!/usr/bin/env bash
# task-force-subagent.sh — TaskCreated hook: enforce subagent delegation depth
#
# Guard logic (hard block):
#   If CW_AGENT_DEPTH is set and >= 1 (env var), OR the atomic depth counter
#   file (.claude/agent-depth.lock) records depth >= 1, we are already inside
#   a subagent. Output decision:block to HARD-STOP further delegation.
#
#   decision:block is processed before LLM sees the context, making it
#   non-bypassable — unlike additionalContext which is advisory only.
#
#   Depth counter file is written by SubagentStart hook and deleted by
#   SubagentStop hook, providing independent tracking beyond env vars.
set -euo pipefail

INPUT=$(cat)

TASK_ID=$(jq -r '.task.id // .task_id // .id // .payload.id // .payload.task.id // "unknown"' <<< "$INPUT" 2>/dev/null)
TASK_TITLE=$(jq -r '.task.title // .title // .payload.title // .payload.task.title // "unknown"' <<< "$INPUT" 2>/dev/null)
TASK_DESCRIPTION=$(jq -r '.task.description // .description // .payload.description // .payload.task.description // ""' <<< "$INPUT" 2>/dev/null)

# Project-scoped log (consistent with hooks.json session log path)
LOG_DIR=".claude"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG="$LOG_DIR/session-$(date +%Y%m%d).log"
printf "[%s] TASK+: %s\n" "$(date -u +%T)" "$TASK_TITLE" >> "$LOG" 2>/dev/null || true

# ============================================================
# Depth guard: two-layer detection
# Layer 1: CW_AGENT_DEPTH env var (set by orchestrator before spawn)
# Layer 2: .claude/agent-depth.lock file (atomic, not env-dependent)
# Both layers are checked — either triggers the hard block.
# ============================================================
ENV_DEPTH="${CW_AGENT_DEPTH:-0}"
LOCK_FILE=".claude/agent-depth.lock"
FILE_DEPTH=0
if [ -f "$LOCK_FILE" ]; then
  # Use flock to atomically read the lock file
  FILE_DEPTH=$( ( flock -s 200; cat "$LOCK_FILE" 2>/dev/null || echo 0 ) 200> "${LOCK_FILE}.flock" )
  # Sanitize: ensure it's a non-negative integer
  FILE_DEPTH=$(printf '%s' "$FILE_DEPTH" | grep -E '^[0-9]+$' || echo 0)
fi

CURRENT_DEPTH=$(( ENV_DEPTH > FILE_DEPTH ? ENV_DEPTH : FILE_DEPTH ))

if [ "$CURRENT_DEPTH" -ge 1 ]; then
  # HARD BLOCK — not advisory. decision:block prevents LLM execution path.
  REASON="Recursive subagent delegation blocked (depth=${CURRENT_DEPTH}). Task \"${TASK_TITLE}\" must be executed DIRECTLY by the current agent. CW_AGENT_DEPTH=${ENV_DEPTH}, lock_file_depth=${FILE_DEPTH}."
  jq -n \
    --arg reason "$REASON" \
    --arg title "$TASK_TITLE" \
    --arg desc "$TASK_DESCRIPTION" \
    '{
      decision: "block",
      reason: $reason,
      hookSpecificOutput: {
        hookEventName: "TaskCreated",
        additionalContext: ("SUBAGENT DEPTH EXCEEDED: Execute task directly.\nTitle: " + $title + "\nDescription: " + $desc)
      }
    }'
  exit 0
fi

# ============================================================
# Depth == 0: Main orchestrator thread — encourage right-sized delegation
# ============================================================
CONTEXT="[DELEGATION RULE]
Task \"$TASK_TITLE\" (ID: $TASK_ID) has been created.

For Complex tasks (5+ files, architectural change, new file type for project): delegate to a fresh subagent via the Agent tool.
For Simple/Standard tasks (1-4 files, clear spec, known pattern): execute directly in the current thread.

MANDATORY before spawning any subagent:
1. Set CW_AGENT_DEPTH=1 in the subagent environment
2. Write depth=1 to .claude/agent-depth.lock

MANDATORY after subagent completes:
1. Delete or zero-out .claude/agent-depth.lock

Task details:
- Title: $TASK_TITLE
- Description: $TASK_DESCRIPTION"

jq -n \
  --arg context "$CONTEXT" \
  '{
    hookSpecificOutput: {
      hookEventName: "TaskCreated",
      additionalContext: $context
    }
  }'
