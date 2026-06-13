#!/usr/bin/env bash
set -euo pipefail

# Unified installer for coder-workflow Claude Code plugin.
# Installs: skills, agents, commands, hooks + builds TypeScript CLI + global install.
# Usage: ./install.sh [--project] [--link] [--dry-run]

PLUGIN_SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST=""
LINK=false
DRY_RUN=false
PROJECT=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
  cat <<'USAGE'
Usage: ./install.sh [options]

Options:
  --project  Install into ./.claude for the current project instead of ~/.claude/skills
  --link     Symlink components instead of copying them
  --dry-run  Print planned actions without changing files
  -h, --help Show this help

Default:
  Installs to ~/.claude/skills/coder-workflow/ so Claude Code auto-discovers
  this as a plugin. Builds the TypeScript CLI and installs it globally.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)  PROJECT=true; shift ;;
    --link)     LINK=true; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --help|-h)  usage; exit 0 ;;
    *)          echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if ! command -v jq &>/dev/null; then
  echo -e "${YELLOW}warning: jq not found on PATH. Hook guard scripts require jq.${NC}"
fi

if $PROJECT; then
  DEST="$(pwd)/.claude"
else
  DEST="${HOME}/.claude/skills/coder-workflow"
fi

run() {
  if $DRY_RUN; then printf 'dry-run: '; printf '%q ' "$@"; printf '\n'
  else "$@"; fi
}

install_item() {
  local src=$1 dest=$2
  run mkdir -p "$(dirname "$dest")"
  if $LINK; then
    run rm -rf "$dest"
    run ln -s "$src" "$dest"
    echo -e "${GREEN}✓${NC} linked $src -> $dest"
  else
    run rm -rf "$dest"
    run cp -a "$src" "$dest"
    echo -e "${GREEN}✓${NC} copied $src -> $dest"
  fi
}

install_dir() {
  local srcdir=$1 destsub=$2
  [[ -d "$srcdir" ]] || return 0
  run mkdir -p "$DEST/$destsub"
  for item in "$srcdir"/*; do
    [[ -e "$item" ]] || continue
    install_item "$item" "$DEST/$destsub/$(basename "$item")"
  done
}

# --- Link entire plugin root ---
if $LINK && ! $PROJECT; then
  echo -e "${BLUE}Linking entire plugin directory...${NC}"
  run rm -rf "$DEST"
  run mkdir -p "$(dirname "$DEST")"
  run ln -s "$PLUGIN_SRC" "$DEST"
  echo -e "${GREEN}✓${NC} linked $PLUGIN_SRC -> $DEST"
  chmod +x "$PLUGIN_SRC"/hooks/scripts/*.sh 2>/dev/null || true
  echo ""
  echo -e "${GREEN}Installation complete! (linked for development)${NC}"
  exit 0
fi

# --- Plugin files installation ---
install_dir "$PLUGIN_SRC/skills" "skills"
install_dir "$PLUGIN_SRC/agents" "agents"
install_dir "$PLUGIN_SRC/commands" "commands"
install_dir "$PLUGIN_SRC/hooks" "hooks"
chmod +x "$DEST"/hooks/scripts/*.sh 2>/dev/null || true
install_item "$PLUGIN_SRC/.claude-plugin/plugin.json" "$DEST/.claude-plugin/plugin.json"

echo -e "${BLUE}Plugin files installed to: $DEST${NC}"

# --- Build + global CLI install ---
echo -e "${YELLOW}Installing dependencies and building...${NC}"
cd "$PLUGIN_SRC"
npm install
npm run build
echo -e "${GREEN}✓ Build complete${NC}"

if ! command -v coder-workflow &> /dev/null; then
  echo -e "${YELLOW}Installing coder-workflow CLI globally...${NC}"
  npm install -g .
  echo -e "${GREEN}✓ Global install complete${NC}"
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Restart Claude Code (or run /reload-plugins)"
echo "2. Start any coding task — /coder-workflow:coder-orchestrator is your entry point"
echo ""
