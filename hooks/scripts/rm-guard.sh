#!/usr/bin/env bash
# rm-guard.sh — PreToolUse guard for catastrophically destructive rm commands.
# Reads JSON from stdin (Claude Code hook input), parses the Bash command,
# and denies execution if the rm targets root, home, or unqualified globs.
set -euo pipefail

# Fallback basic bash parser if python3 is missing
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(jq -r '.tool_input.command // empty' <<< "$INPUT" 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Collapse spaces
NORM=$(printf '%s' "$COMMAND" | tr -s ' ')

# Helper: check if string has a specific word bounded by spaces or line ends
contains_word() {
  local str="$1"
  local word="$2"
  # Escape special chars for grep
  local escaped_word
  escaped_word=$(printf '%s' "$word" | sed 's/[.昨*+$?^]/\\&/g')
  printf '%s' "$str" | grep -qE "(^|[[:space:]])${escaped_word}([[:space:]]|$)" && return 0
  return 1
}

# Check if it has rm and recursive flags
if printf '%s' "$NORM" | grep -qE '\brm\b' && printf '%s' "$NORM" | grep -qE '\s-[a-zA-Z]*[rR]'; then
  # Check for dangerous targets as standalone words
  DANGEROUS_TARGETS=("/" "*" "." "./" "./*" "/*" "~" "~/" "~/*" "\$HOME" "\$HOME/" "\$HOME/*")
  for TARGET in "${DANGEROUS_TARGETS[@]}"; do
    if contains_word "$NORM" "$TARGET"; then
      reason="coder-workflow safety guard: rm command targeting '${TARGET}' with recursive flag is blocked. Narrow the target explicitly."
      jq -n \
        --arg reason "$reason" \
        '{
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: $reason
          }
        }'
      exit 0
    fi
  done
fi

exit 0
