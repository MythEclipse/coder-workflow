#!/usr/bin/env bash
# env-write-guard.sh — PreToolUse guard for writes to .env* files.
# Checks whether the file is gitignored. If not, injects a system message
# warning Claude. Never blocks — writes to env files are always allowed,
# but unignored env files are a secrets-exposure risk.
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat)
FILE=$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<< "$INPUT" 2>/dev/null)

if [ -z "$FILE" ]; then
  exit 0
fi

# Only care about .env* files
BASENAME=$(basename "$FILE")
if ! printf '%s' "$BASENAME" | grep -qE '^\.env'; then
  exit 0
fi

# Check if git knows about this path and whether it is ignored
if command -v git >/dev/null 2>&1 && [ -f ".gitignore" ]; then
  if git check-ignore -q "$FILE" 2>/dev/null; then
    # Gitignored — safe, pass silently
    exit 0
  fi
fi

# File is NOT confirmed gitignored — warn Claude via systemMessage
jq -n \
  --arg f "$FILE" \
  '{
    systemMessage: "coder-workflow warning: \($f) does not appear to be gitignored. Writing secrets to a tracked env file risks committing credentials to the repository. Verify .gitignore covers this file before committing. If this is intentional (e.g. a .env.example), ignore this warning."
  }'
exit 0
