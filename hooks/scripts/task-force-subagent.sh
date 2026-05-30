#!/usr/bin/env bash
# task-force-subagent.sh — TaskCreated hook to force subagent execution via additionalContext injection.
set -euo pipefail

# Baca JSON input dari stdin
INPUT=$(cat)

# Ambil detail task secara robust
TASK_ID=$(echo "$INPUT" | jq -r '.task.id // .task_id // .id // "unknown"')
TASK_TITLE=$(echo "$INPUT" | jq -r '.task.title // .title // "unknown"')
TASK_DESCRIPTION=$(echo "$INPUT" | jq -r '.task.description // .description // ""')

# Catat log ke file session
printf "[%s] TASK+: %s\n" "$(date -u +%T)" "$TASK_TITLE" >> /tmp/cw-session.log 2>/dev/null || true

# Bangun instruksi tambahan untuk Claude
CONTEXT="[MANDATORY EXECUTION RULE]
Task \"$TASK_TITLE\" (ID: $TASK_ID) has been created.

MANDATORY: You MUST execute this task using a separate subagent by calling the Agent tool (invoke_subagent / define_subagent).
DO NOT execute this task directly in the main thread.

Correct workflow:
1. Call the Agent tool with a prompt containing the details of this task.
2. Wait for the subagent to complete the task.
3. Report the subagent's results back to the user.

Task details to pass to the subagent:
- Title: $TASK_TITLE
- Description: $TASK_DESCRIPTION

Violating this rule is strictly prohibited."

# Output JSON dengan additionalContext
jq -n \
  --arg context "$CONTEXT" \
  '{
    hookSpecificOutput: {
      hookEventName: "TaskCreated",
      additionalContext: $context
    }
  }'
