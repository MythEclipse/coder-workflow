#!/usr/bin/env bash
set -euo pipefail

# Installer for the coder-workflow Claude Code plugin components.
# Usage: ./install.sh [--project] [--link] [--dry-run] [--skills-only] [--agents-only] [--hooks-only] [--commands-only] [<component>...]

PLUGIN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST="${HOME}/.claude"
LINK=false
DRY_RUN=false
SKILLS_ONLY=false
AGENTS_ONLY=false
HOOKS_ONLY=false
COMMANDS_ONLY=false
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
  --hooks-only     Install only hooks
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
      SKILLS_ONLY=true; shift ;;
    --agents-only)
      AGENTS_ONLY=true; shift ;;
    --hooks-only)
      HOOKS_ONLY=true; shift ;;
    --commands-only)
      COMMANDS_ONLY=true; shift ;;
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

if ! $AGENTS_ONLY && ! $HOOKS_ONLY && ! $COMMANDS_ONLY; then
  install_dir_items "$PLUGIN_ROOT/skills" "skills"
fi

if ! $SKILLS_ONLY && ! $HOOKS_ONLY && ! $COMMANDS_ONLY; then
  install_dir_items "$PLUGIN_ROOT/agents" "agents"
fi

if ! $SKILLS_ONLY && ! $AGENTS_ONLY && ! $COMMANDS_ONLY; then
  install_dir_items "$PLUGIN_ROOT/hooks" "hooks"
fi

if ! $SKILLS_ONLY && ! $AGENTS_ONLY && ! $HOOKS_ONLY; then
  install_dir_items "$PLUGIN_ROOT/commands" "commands"
fi

echo "Install complete: $DEST"
echo "Restart Claude Code or run /reload."
