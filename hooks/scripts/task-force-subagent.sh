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
#
# Complexity heuristic (depth == 0):
#   Analyzes task title and description to suggest direct execution vs delegation.
#   Factors: word count, file-path mentions, complexity keywords.
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
# Depth == 0: Main orchestrator thread — complexity heuristic
# ============================================================
# Combine title + description for analysis
FULL_TEXT=$(printf '%s %s' "$TASK_TITLE" "$TASK_DESCRIPTION")

# Score factors
COMPLEXITY_SCORE=0

# 1. Length heuristic: long descriptions suggest multi-file, complex work
WORD_COUNT=$(printf '%s' "$FULL_TEXT" | wc -w | tr -d ' ')
if [ "$WORD_COUNT" -gt 80 ]; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE + 3))
elif [ "$WORD_COUNT" -gt 40 ]; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE + 2))
elif [ "$WORD_COUNT" -gt 20 ]; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE + 1))
fi

# 2. File-path mentions (many file paths = multi-file change)
FILE_MENTIONS=$(printf '%s' "$FULL_TEXT" | grep -oE '(src/|lib/|app/|test/|\.ts|\.js|\.py|\.go|\.rs|\.java|\.kt)' 2>/dev/null | wc -l | tr -d ' ')
if [ "$FILE_MENTIONS" -ge 5 ]; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE + 3))
elif [ "$FILE_MENTIONS" -ge 3 ]; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE + 2))
elif [ "$FILE_MENTIONS" -ge 1 ]; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE + 1))
fi

# 3. Complexity keywords
COMPLEX_KEYWORDS="refactor|architect|migration|multi.file|new.module|implement.*feature|add.*endpoint|database.*schema|authentication|authorization|middleware|circuit.breaker|event.bus|websocket|real.time|deployment|ci.cd|docker|kubernetes"
if printf '%s' "$FULL_TEXT" | grep -qiE "$COMPLEX_KEYWORDS" 2>/dev/null; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE + 2))
fi

# 4. Simple keywords (reduce score)
SIMPLE_KEYWORDS="fix typo|update readme|rename|rename.*variable|add.*comment|format|whitespace|remove.*unused"
if printf '%s' "$FULL_TEXT" | grep -qiE "$SIMPLE_KEYWORDS" 2>/dev/null; then
  COMPLEXITY_SCORE=$((COMPLEXITY_SCORE - 2))
fi

# Clamp score to 0-8
if [ "$COMPLEXITY_SCORE" -lt 0 ]; then
  COMPLEXITY_SCORE=0
elif [ "$COMPLEXITY_SCORE" -gt 8 ]; then
  COMPLEXITY_SCORE=8
fi

# Determine recommendation
if [ "$COMPLEXITY_SCORE" -ge 5 ]; then
  COMPLEXITY_LEVEL="COMPLEX"
  DELEGATION_ADVICE="MANDATORY: spawn multiple parallel subagents to handle different files/domains simultaneously"
elif [ "$COMPLEXITY_SCORE" -ge 3 ]; then
  COMPLEXITY_LEVEL="MODERATE"
  DELEGATION_ADVICE="spawn at least 2 parallel subagents (e.g., implementer and test-writer)"
else
  COMPLEXITY_LEVEL="SIMPLE"
  DELEGATION_ADVICE="even simple tasks should be parallelized if they touch more than 1 concern; otherwise execute directly"
fi

CONTEXT="[DELEGATION RULE]
Task \"$TASK_TITLE\" (ID: $TASK_ID) has been created.

Complexity assessment: $COMPLEXITY_LEVEL (score: $COMPLEXITY_SCORE/8)
- Word count: $WORD_COUNT
- File references: $FILE_MENTIONS
- Recommendation: $DELEGATION_ADVICE

CORE DIRECTIVE: Parallel Subagents — Always On. Token cost is not a constraint. Speed and parallelism are the priority. Whenever a task can be split into independent units of work, spawn multiple subagents in parallel using the Task tool. Do NOT work sequentially unless tasks have hard dependencies on each other.

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
