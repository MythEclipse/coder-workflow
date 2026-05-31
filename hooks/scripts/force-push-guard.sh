#!/usr/bin/env bash
# force-push-guard.sh — PreToolUse guard for git push --force to main/master.
# git push --force-with-lease is ALLOWED (it is the safe variant).
# git push --force (or -f) to main or master is DENIED.
# All other git push variants pass through silently.
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(jq -r '.tool_input.command // empty' <<< "$INPUT" 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only proceed if this is a git push with --force or -f (not --force-with-lease)
if ! printf '%s' "$COMMAND" | grep -qE 'git\s+push'; then
  exit 0
fi

# --force-with-lease is safe — pass through
if printf '%s' "$COMMAND" | grep -q 'force-with-lease'; then
  exit 0
fi

# Check for hard --force or -f flag
if ! printf '%s' "$COMMAND" | grep -qE '(--force\b|-f\b)'; then
  exit 0
fi

# Check if the target ref is main or master
if printf '%s' "$COMMAND" | grep -qE '\b(main|master)\b'; then
  jq -n \
    --arg cmd "$COMMAND" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "coder-workflow safety: force-push to main/master is blocked. Use a feature branch + PR, or use --force-with-lease on a non-protected branch. Command was: \($cmd)"
      }
    }'
  exit 0
fi

# Force push to non-protected branch — allow but surface a warning
jq -n \
  '{
    systemMessage: "coder-workflow notice: git push --force detected on non-main/master branch. Ensure collaborators are aware — force-push rewrites history."
  }'
exit 0
