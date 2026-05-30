#!/usr/bin/env bash
set -euo pipefail

# Installer for the coder-workflow Claude Code plugin components.
# Usage: ./install.sh [--project] [--link] [--dry-run] [--skills-only] [--agents-only] [--hooks-only] [--commands-only] [<component>...]

PLUGIN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST="${HOME}/.claude"
LINK=false
DRY_RUN=false
SKILLS_ONLY=0
AGENTS_ONLY=0
HOOKS_ONLY=0
COMMANDS_ONLY=0
COMPONENTS=()

usage() {
  cat <<'USAGE'
Usage: ./install.sh [options] [component...]

Options:
  --project        Install into ./.claude for the current project instead of ~/.claude
  --link           Symlink components instead of copying them
  --dry-run        Print planned actions without changing files
  --skills-only    Install only skills
  --agents-only    Install only agents
  --hooks-only     Install only hooks (merges with existing hooks.json)
  --commands-only  Install only commands
  -h, --help       Show this help

Components:
  Optional component names to install. Examples: coder, refraktor, auditor,
  workflow-planner, code-implementer, architecture-auditor, coder-orchestrator.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      DEST="$(pwd)/.claude"; shift ;;
    --link)
      LINK=true; shift ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    --skills-only)
      SKILLS_ONLY=1; shift ;;
    --agents-only)
      AGENTS_ONLY=1; shift ;;
    --hooks-only)
      HOOKS_ONLY=1; shift ;;
    --commands-only)
      COMMANDS_ONLY=1; shift ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      COMPONENTS+=("$1"); shift ;;
  esac
done

if [ "$(( SKILLS_ONLY + AGENTS_ONLY + HOOKS_ONLY + COMMANDS_ONLY ))" -gt 1 ]; then
  echo "error: only one of --skills-only, --agents-only, --hooks-only, --commands-only allowed" >&2
  exit 1
fi

contains_component() {
  local name=$1
  if [[ ${#COMPONENTS[@]} -eq 0 ]]; then
    return 0
  fi
  local wanted
  for wanted in "${COMPONENTS[@]}"; do
    if [[ "$wanted" == "$name" ]]; then
      return 0
    fi
  done
  return 1
}

run() {
  if $DRY_RUN; then
    printf 'dry-run: '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

install_item() {
  local src=$1
  local dest=$2
  local parent
  parent=$(dirname "$dest")

  run mkdir -p "$parent"

  if $LINK; then
    run rm -rf "$dest"
    run ln -s "$src" "$dest"
    if $DRY_RUN; then
      echo "would link $src -> $dest"
    else
      echo "linked $src -> $dest"
    fi
  else
    run rm -rf "$dest"
    run cp -a "$src" "$dest"
    if $DRY_RUN; then
      echo "would copy $src -> $dest"
    else
      echo "copied $src -> $dest"
    fi
  fi
}

install_dir_items() {
  local srcdir=$1
  local destsub=$2

  [[ -d "$srcdir" ]] || return 0
  run mkdir -p "$DEST/$destsub"

  local item name
  for item in "$srcdir"/*; do
    [[ -e "$item" ]] || continue
    name=$(basename "$item")
    contains_component "$name" || continue
    install_item "$item" "$DEST/$destsub/$name"
  done
}

# Merge hooks.json: appends new hooks from this plugin into existing hooks.json
# instead of overwriting. Each hook event (SessionStart, PostToolUse, Stop) has
# its array extended with new entries. Deduplicates by description.
merge_hooks() {
  local src_hooks="$PLUGIN_ROOT/hooks/hooks.json"
  local dest_hooks="$DEST/hooks/hooks.json"
  [[ -f "$src_hooks" ]] || return 0

  # If no existing hooks, just copy
  if [[ ! -f "$dest_hooks" ]]; then
    run mkdir -p "$DEST/hooks"
    if $LINK; then
      run ln -s "$src_hooks" "$dest_hooks"
      echo "linked hooks: $src_hooks -> $dest_hooks"
    else
      run cp -a "$src_hooks" "$dest_hooks"
      echo "installed hooks: $src_hooks -> $dest_hooks"
    fi
    return 0
  fi

  # If jq is available, merge properly
  if command -v jq &> /dev/null; then
    if $DRY_RUN; then
      printf 'dry-run: jq merge hooks %s -> %s\n' "$src_hooks" "$dest_hooks"
      return 0
    fi

    local merged
    merged=$(jq -s '
      # Reduce all inputs into first (existing) object
      reduce .[1:][] as $new (.[0];
        . as $existing |
        $new | to_entries | reduce .[] as $entry (
          $existing;
          if $entry.key == "hooks" then
            # Merge hooks by event type
            .hooks as $ehooks |
            $entry.value | to_entries | reduce .[] as $hevent (
              $existing;
              .hooks[$hevent.key] = (
                (($ehooks[$hevent.key] // []) + $hevent.value) | unique_by(.description // .)
              )
            )
          elif $entry.key == "description" then
            # Combine descriptions
            .description = ((.description // "") + "; " + $entry.value)
          else
            .[$entry.key] = $entry.value
          end
        )
      )
    ' "$dest_hooks" "$src_hooks")

    echo "$merged" > "$dest_hooks"
    echo "merged hooks: $src_hooks -> $dest_hooks"
  else
    # Fallback without jq: append a warning
    echo "WARNING: jq not found — hooks will be appended, not merged" >&2
    echo "Install jq for proper hook merging: sudo apt install jq / brew install jq" >&2
    if $DRY_RUN; then
      printf 'dry-run: append hooks (jq unavailable)\n'
    else
      # Backup existing, then use source hooks (user should merge manually)
      cp "$dest_hooks" "${dest_hooks}.backup"
      echo "Backed up existing hooks to ${dest_hooks}.backup" >&2
      # Copy source hooks — user can manually merge from backup
      cp -a "$src_hooks" "$dest_hooks"
      echo "installed hooks: $src_hooks -> $dest_hooks (existing backed up)" >&2
    fi
  fi
}

if [[ $AGENTS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 ]]; then
  install_dir_items "$PLUGIN_ROOT/skills" "skills"
fi

if [[ $SKILLS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 ]]; then
  install_dir_items "$PLUGIN_ROOT/agents" "agents"
fi

if [[ $SKILLS_ONLY -eq 0 && $AGENTS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 ]]; then
  merge_hooks
fi

if [[ $SKILLS_ONLY -eq 0 && $AGENTS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 ]]; then
  install_dir_items "$PLUGIN_ROOT/commands" "commands"
fi

echo "Install complete: $DEST"
echo "Restart Claude Code or run /reload."
