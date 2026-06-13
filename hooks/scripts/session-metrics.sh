#!/usr/bin/env bash
# session-metrics.sh — SessionEnd hook: parse session log and write structured metrics
# Reads .claude/session-YYYYMMDD.log and writes .claude/session-metrics.json
set -euo pipefail

LOG_DIR=".claude"
mkdir -p "$LOG_DIR" 2>/dev/null || true
TODAY=$(date +%Y%m%d)
LOG="$LOG_DIR/session-$TODAY.log"
METRICS="$LOG_DIR/session-metrics.json"

if [ ! -f "$LOG" ]; then
  # No session log — write empty metrics
  jq -n '{
    date: (now | strftime("%Y-%m-%d")),
    tasks_created: 0,
    tasks_completed: 0,
    writes: 0,
    commits: 0,
    agents_spawned: 0,
    failures: 0,
    prompts: 0,
    deferred_bugs: 0
  }' > "$METRICS"
  exit 0
fi

TASKS_CREATED=$(grep -c "TASK+:" "$LOG" 2>/dev/null || true)
TASKS_COMPLETED=$(grep -c "TASK done:" "$LOG" 2>/dev/null || true)
WRITES=$(grep -c "WRITE:" "$LOG" 2>/dev/null || true)
COMMITS=$(grep -c "GIT COMMIT:" "$LOG" 2>/dev/null || true)
FAILURES=$(grep -c "FAIL" "$LOG" 2>/dev/null || true)
AGENTS=$(grep -c "AGENT START:" "$LOG" 2>/dev/null || true)
PROMPTS=$(grep -c "PROMPT:" "$LOG" 2>/dev/null || true)
BRANCH_SWITCHES=$(grep -c "BRANCH SWITCH:" "$LOG" 2>/dev/null || true)

# Count deferred bugs if file exists
DEFERRED_BUGS=0
if [ -f "$LOG_DIR/deferred-bugs.json" ]; then
  DEFERRED_BUGS=$(jq 'length' "$LOG_DIR/deferred-bugs.json" 2>/dev/null || echo 0)
fi

# Calculate first and last prompt timestamps for session duration
FIRST_PROMPT=$(grep "PROMPT:" "$LOG" 2>/dev/null | head -1 | grep -oE '\[[0-9:]+\]' | tr -d '[]' || echo "")
LAST_PROMPT=$(grep "PROMPT:" "$LOG" 2>/dev/null | tail -1 | grep -oE '\[[0-9:]+\]' | tr -d '[]' || echo "")

jq -n \
  --arg date "$(date +%Y-%m-%d)" \
  --argjson tasks_created "$TASKS_CREATED" \
  --argjson tasks_completed "$TASKS_COMPLETED" \
  --argjson writes "$WRITES" \
  --argjson commits "$COMMITS" \
  --argjson agents "$AGENTS" \
  --argjson failures "$FAILURES" \
  --argjson prompts "$PROMPTS" \
  --argjson deferred_bugs "$DEFERRED_BUGS" \
  --arg first_prompt "$FIRST_PROMPT" \
  --arg last_prompt "$LAST_PROMPT" \
  '{
    date: $date,
    tasks_created: $tasks_created,
    tasks_completed: $tasks_completed,
    writes: $writes,
    commits: $commits,
    agents_spawned: $agents,
    failures: $failures,
    prompts: $prompts,
    deferred_bugs: $deferred_bugs,
    branch_switches: (env.BRANCH_SWITCHES // 0),
    session_window: {
      first_prompt: $first_prompt,
      last_prompt: $last_prompt
    },
    task_completion_rate: (if $tasks_created > 0 then ($tasks_completed / $tasks_created * 100 | round) else 0 end),
    agent_utilization: (if $prompts > 0 then ($agents / $prompts * 100 | round) else 0 end)
  }' > "$METRICS"

# Also output summary to stdout for the hook message
echo "Session metrics saved to $METRICS: tasks=$TASKS_CREATED created, $TASKS_COMPLETED completed | agents=$AGENTS | writes=$WRITES | commits=$COMMITS | failures=$FAILURES"
