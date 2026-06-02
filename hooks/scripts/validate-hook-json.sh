#!/usr/bin/env bash
# Validate hook JSON input/output format.
# Called from PreToolUse/PostToolUse hooks to inspect incoming JSON.
# Usage: echo '{"tool_input":{...}}' | validate-hook-json.sh
#        validate-hook-json.sh < path/to/hooks.json   # validates entire hook file
# Returns: 0 if valid, 1 if malformed

set -o pipefail

validate_single() {
  local input
  input=$(cat)

  # Must be valid JSON
  if ! jq empty <<<"$input" 2>/dev/null; then
    echo "HOOK_VALIDATE: FAIL — input is not valid JSON"
    return 1
  fi

  # Hook input must have tool_name (PostToolUse/PreToolUse) or type (other events)
  if ! jq -e '.tool_name // false' <<<"$input" >/dev/null 2>&1; then
    # Not a tool hook event — still valid
    echo "HOOK_VALIDATE: OK (non-tool event, no tool_name)"
    return 0
  fi

  local tool_name
  tool_name=$(jq -r '.tool_name' <<<"$input")

  # Verify the tool has expected shape
  case "$tool_name" in
    Write|Edit|MultiEdit|NotebookEdit)
      if ! jq -e '.tool_input.file_path // .tool_input.path // empty' <<<"$input" >/dev/null 2>&1; then
        echo "HOOK_VALIDATE: WARN — $tool_name tool missing file_path"
      fi
      ;;
    Bash)
      if ! jq -e '.tool_input.command // empty' <<<"$input" >/dev/null 2>&1; then
        echo "HOOK_VALIDATE: WARN — Bash tool missing command"
      fi
      ;;
    Grep|Glob|Read|Agent)
      # No strict validation needed
      ;;
  esac

  echo "HOOK_VALIDATE: OK tool=$tool_name"
  return 0
}

validate_hooks_file() {
  local file=$1

  # Parse all hook command strings, check they produce valid jq output
  if ! jq empty "$file" 2>/dev/null; then
    echo "HOOK_VALIDATE: FAIL — hooks.json is not valid JSON"
    return 1
  fi

  # Check required top-level keys exist
  local keys
  keys=$(jq -r '.hooks | keys[]' "$file" 2>/dev/null)
  if [ -z "$keys" ]; then
    echo "HOOK_VALIDATE: FAIL — missing hooks object in hooks.json"
    return 1
  fi

  echo "HOOK_VALIDATE: hooks.json structure OK"
  echo "  Hook events: $(echo "$keys" | tr '\n' ' ')"
  return 0
}

# Main
if [ -t 0 ] && [ $# -gt 0 ]; then
  # File mode: validate entire hooks.json
  validate_hooks_file "$1"
  exit $?
else
  # Pipe mode: validate single hook event JSON
  validate_single
  exit $?
fi
