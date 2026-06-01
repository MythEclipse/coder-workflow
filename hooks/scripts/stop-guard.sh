#!/usr/bin/env bash
# stop-guard.sh — Stop hook: enforce task persistence
# Prevents the model from stopping prematurely when it has active tasks.
set -euo pipefail

LOG_DIR=".claude"
mkdir -p "$LOG_DIR" 2>/dev/null || true
TODAY=$(date +%Y%m%d)
LOG="$LOG_DIR/session-$TODAY.log"
BLOCK_FILE="$LOG_DIR/stop-block.count"

if [ -f "$LOG" ]; then
  TASKS_CREATED=$(grep -c "TASK+:" "$LOG" 2>/dev/null || echo 0)
  TASKS_COMPLETED=$(grep -c "TASK done:" "$LOG" 2>/dev/null || echo 0)
  
  if [ "$TASKS_CREATED" -gt "$TASKS_COMPLETED" ]; then
    COUNT=$(cat "$BLOCK_FILE" 2>/dev/null || echo 0)
    COUNT=$(printf '%s' "$COUNT" | grep -E '^[0-9]+$' || echo 0)
    
    if [ "$COUNT" -lt 1 ]; then
      echo $((COUNT + 1)) > "$BLOCK_FILE"
      
      REASON="You have unfinished tasks ($TASKS_COMPLETED/$TASKS_CREATED). You attempted to stop, which interrupts the workflow. If you are planning to implement something, DO NOT STOP — call the appropriate tool immediately. Only stop if you genuinely need human input."
      
      jq -n \
        --arg reason "$REASON" \
        '{
          decision: "block",
          reason: $reason,
          systemMessage: ("coder-workflow: " + $reason)
        }'
      exit 0
    else
      # Let it stop, reset counter for next time
      echo 0 > "$BLOCK_FILE"
    fi
  fi
fi

exit 0
