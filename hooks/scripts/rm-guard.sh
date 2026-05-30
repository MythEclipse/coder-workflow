#!/usr/bin/env bash
# rm-guard.sh — PreToolUse guard for catastrophically destructive rm commands.
# Reads JSON from stdin (Claude Code hook input), parses the Bash command,
# and denies execution if the rm targets root, home, or unqualified globs.
# Non-destructive rm commands pass through silently (exit 0, no output).
set -euo pipefail

# Require jq — if missing, pass through silently rather than false-blocking.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Normalise: collapse multiple spaces, strip leading env assignments
NORM=$(printf '%s' "$COMMAND" | sed 's/[A-Z_][A-Z_0-9]*=[^ ]* //g' | tr -s ' ')

# Helper: check if rm has both -r/-R and -f flags (combined or separate)
has_rf_flags() {
  local cmd="$1"
  # Combined: -rf, -fr, -Rf, -fR, -rRf etc.
  printf '%s' "$cmd" | grep -qE 'rm\s+-[a-zA-Z]*[rR][a-zA-Z]*[fF]|rm\s+-[a-zA-Z]*[fF][a-zA-Z]*[rR]' && return 0
  # Separate flags: rm -r -f or rm -f -r
  printf '%s' "$cmd" | grep -qE 'rm(\s+-[a-zA-Z]+)+\s' && \
    printf '%s' "$cmd" | grep -qE 'rm.*-[a-zA-Z]*[rR]' && \
    printf '%s' "$cmd" | grep -qE 'rm.*-[a-zA-Z]*[fF]' && return 0
  return 1
}

if ! has_rf_flags "$NORM"; then
  exit 0
fi

# Extract the target path(s) — everything after the flags
TARGET=$(printf '%s' "$NORM" | sed 's/rm\s\+\(-[a-zA-Z]\+\s*\)*//g' | sed 's/^\s*//;s/\s*$//')

# Patterns that are catastrophically dangerous
DANGEROUS_PATTERNS=(
  '^/$'
  '^\*$'
  '^\.$'
  '^[.][/]$'
  '^[.][/][*]$'
  '^[/][*]$'
  '^~$'
  '^~[/]$'
  '^~[/][*]$'
  '^\$HOME$'
  '^\$HOME[/]$'
  '^\$HOME[/][*]$'
)

for PAT in "${DANGEROUS_PATTERNS[@]}"; do
  # Check each whitespace-separated token in TARGET
  for TOKEN in $TARGET; do
    if printf '%s' "$TOKEN" | grep -qE "$PAT"; then
      jq -n \
        --arg reason "coder-workflow safety guard: rm -rf targeting '${TOKEN}' is blocked. This would destroy critical filesystem paths. Narrow the target explicitly (e.g. rm -rf ./dist/specific-file) and re-run." \
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
done

exit 0
