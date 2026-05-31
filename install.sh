#!/usr/bin/env bash
set -euo pipefail

# Unified installer for coder-workflow Claude Code plugin.
# Installs: skills, agents, commands, hooks (+ hooks/scripts guard scripts) + builds TypeScript CLI + MCP server + global install.
# Usage: ./install.sh [--project] [--link] [--dry-run] [--mcp-only] [--skills-only] [--agents-only] [--hooks-only] [--commands-only] [<component>...]

PLUGIN_SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Defaults
DEST=""
LINK=false
DRY_RUN=false
PROJECT=false
MCP_ONLY=false
SKILLS_ONLY=0
AGENTS_ONLY=0
HOOKS_ONLY=0
COMMANDS_ONLY=0
COMPONENTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
  cat <<'USAGE'
Usage: ./install.sh [options] [component...]

Options:
  --project        Install into ./.claude for the current project instead of ~/.claude/plugins
  --link           Symlink components instead of copying them
  --dry-run        Print planned actions without changing files
  --mcp-only       Install only the MCP server (build + global CLI + MCP config)
  --skills-only    Install only skills
  --agents-only    Install only agents
  --hooks-only     Install only hooks
  --commands-only  Install only commands
  -h, --help       Show this help

Components:
  Optional component names to install. Examples: coder, refraktor, auditor,
  scan-codegraph, coder-orchestrator, etc.

Default (no --project):
  Installs to ~/.claude/skills/coder-workflow/ so Claude Code auto-discovers
  this as a plugin. Also builds the TypeScript CLI, installs it globally,
  and configures the CodeGraph MCP server.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT=true; shift ;;
    --link)
      LINK=true; shift ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    --mcp-only)
      MCP_ONLY=true; shift ;;
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

# Dependency check: jq is required by hook guard scripts.
# Emit a warning rather than a hard error — the plugin still works without it,
# but rm-guard.sh / force-push-guard.sh / env-write-guard.sh will be no-ops.
if ! command -v jq &>/dev/null; then
  echo -e "${YELLOW}warning: jq not found on PATH.${NC}"
  echo -e "${YELLOW}  The hook guard scripts (rm-guard, force-push-guard, env-write-guard)${NC}"
  echo -e "${YELLOW}  require jq to parse Claude Code's hook JSON input.${NC}"
  echo -e "${YELLOW}  Install jq (https://jqlang.org) for full hook functionality.${NC}"
fi

if $PROJECT; then
  DEST="$(pwd)/.claude"
else
  DEST="${HOME}/.claude/skills/coder-workflow"
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
      echo -e "${GREEN}✓${NC} linked $src -> $dest"
    fi
  else
    run rm -rf "$dest"
    run cp -a "$src" "$dest"
    if $DRY_RUN; then
      echo "would copy $src -> $dest"
    else
      echo -e "${GREEN}✓${NC} copied $src -> $dest"
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

install_mcp() {
  echo -e "${BLUE}Installing MCP server to Claude Code...${NC}"

  # Build project if dist/ is missing
  if [ ! -d "$PLUGIN_SRC/dist" ]; then
    echo -e "${YELLOW}Building coder-workflow (TypeScript → CLI + MCP server)...${NC}"
    cd "$PLUGIN_SRC"
    npm install
    npm run build
    echo -e "${GREEN}✓ Build complete${NC}"
  fi

  # Install globally if not already installed
  if ! command -v coder-workflow &> /dev/null; then
    echo -e "${YELLOW}Installing coder-workflow CLI globally...${NC}"
    cd "$PLUGIN_SRC"
    npm install -g .
    echo -e "${GREEN}✓ Global install complete${NC}"
  fi

  BIN=$(which coder-workflow)
  echo -e "${BLUE}Using coder-workflow: $BIN${NC}"

  # Determine MCP config file and scope
  if $PROJECT; then
    MCP_CONFIG_FILE="$PLUGIN_SRC/.mcp.json"
    SCOPE="project"
  else
    MCP_CONFIG_FILE="${HOME}/.claude.json"
    SCOPE="user"
  fi

  mkdir -p "$(dirname "$MCP_CONFIG_FILE")"

  # Create or update MCP configuration
  if [ ! -f "$MCP_CONFIG_FILE" ]; then
    echo -e "${BLUE}Creating new MCP configuration...${NC}"
    cat > "$MCP_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "$BIN",
      "args": ["mcp"],
      "env": {
        "CODEGRAPH_DEFAULT_UI_PORT": "3737"
      }
    }
  }
}
EOF
  else
    echo -e "${YELLOW}Found existing MCP configuration${NC}"

    if command -v jq &> /dev/null; then
      echo -e "${BLUE}Updating MCP configuration with jq...${NC}"
      jq ".mcpServers.codegraph = {\"type\": \"stdio\", \"command\": \"$BIN\", \"args\": [\"mcp\"], \"env\": {\"CODEGRAPH_DEFAULT_UI_PORT\": \"3737\"}}" "$MCP_CONFIG_FILE" > "$MCP_CONFIG_FILE.tmp"
      mv "$MCP_CONFIG_FILE.tmp" "$MCP_CONFIG_FILE"
    else
      echo -e "${YELLOW}jq not found, please manually add MCP configuration${NC}"
      echo -e "${YELLOW}Add this to $MCP_CONFIG_FILE:${NC}"
      cat << EOF
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "$BIN",
      "args": ["mcp"],
      "env": {
        "CODEGRAPH_DEFAULT_UI_PORT": "3737"
      }
    }
  }
}
EOF
    fi
  fi

  echo -e "${GREEN}✓ MCP configuration updated${NC}"
  echo -e "${BLUE}Configuration saved to: $MCP_CONFIG_FILE${NC}"
}

# --- MCP only mode ---
if $MCP_ONLY; then
  install_mcp
  echo ""
  echo -e "${GREEN}Installation complete!${NC}"
  echo "  CLI: $(which coder-workflow 2>/dev/null || echo 'not yet installed')"
  echo "  MCP: Available via 'coder-workflow mcp'"
  echo ""
  echo "Restart Claude Code to use the MCP server."
  exit 0
fi

# --- Link entire plugin root for development ---
if $LINK && ! $PROJECT && [[ $SKILLS_ONLY -eq 0 && $AGENTS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 && ${#COMPONENTS[@]} -eq 0 ]]; then
  echo -e "${BLUE}Linking entire plugin directory to Claude Code skills...${NC}"
  run rm -rf "$DEST"
  run mkdir -p "$(dirname "$DEST")"
  run ln -s "$PLUGIN_SRC" "$DEST"
  if $DRY_RUN; then
    echo "would link $PLUGIN_SRC -> $DEST"
  else
    echo -e "${GREEN}✓${NC} linked $PLUGIN_SRC -> $DEST"
  fi
  # Guarantee execute bit on source guard scripts
  if [[ -d "$PLUGIN_SRC/hooks/scripts" ]] && ! $DRY_RUN; then
    chmod +x "$PLUGIN_SRC"/hooks/scripts/*.sh 2>/dev/null && \
      echo -e "${GREEN}✓${NC} source hook scripts are executable" || true
  elif $DRY_RUN; then
    echo "dry-run: chmod +x $PLUGIN_SRC/hooks/scripts/*.sh"
  fi

  # Build & install MCP config
  install_mcp

  echo ""
  echo -e "${GREEN}Installation complete! (Whole repository linked for development)${NC}"
  exit 0
fi

# --- Plugin files installation ---
if [[ $AGENTS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 ]]; then
  install_dir_items "$PLUGIN_SRC/skills" "skills"
fi

if [[ $SKILLS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 ]]; then
  install_dir_items "$PLUGIN_SRC/agents" "agents"
fi

if [[ $SKILLS_ONLY -eq 0 && $AGENTS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 ]]; then
  install_dir_items "$PLUGIN_SRC/hooks" "hooks"
  # Guarantee execute bit on guard scripts — cp -a preserves permissions, but
  # some environments (NFS, restrictive umask, certain CI runners) strip them.
  if [[ -d "$DEST/hooks/scripts" ]] && ! $DRY_RUN; then
    chmod +x "$DEST"/hooks/scripts/*.sh 2>/dev/null && \
      echo -e "${GREEN}✓${NC} hook scripts are executable" || true
  elif $DRY_RUN; then
    echo "dry-run: chmod +x $DEST/hooks/scripts/*.sh"
  fi
fi

if [[ $SKILLS_ONLY -eq 0 && $AGENTS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 ]]; then
  install_dir_items "$PLUGIN_SRC/commands" "commands"
fi

# Install plugin.json so Claude Code recognizes this as a plugin
if [[ $SKILLS_ONLY -eq 0 && $AGENTS_ONLY -eq 0 && $HOOKS_ONLY -eq 0 && $COMMANDS_ONLY -eq 0 ]] && ! $PROJECT; then
  install_item "$PLUGIN_SRC/.claude-plugin/plugin.json" "$DEST/.claude-plugin/plugin.json"
  install_item "$PLUGIN_SRC/.cursor-plugin/plugin.json" "$DEST/.cursor-plugin/plugin.json"
  install_item "$PLUGIN_SRC/gemini-extension.json" "$DEST/gemini-extension.json"
  # Also copy .mcp.json for reference
  install_item "$PLUGIN_SRC/.mcp.json" "$DEST/.mcp.json"
fi

echo -e "${BLUE}Plugin files installed to: $DEST${NC}"

# --- Build + global install + MCP config ---
install_mcp

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo -e "${BLUE}Configuration:${NC}"
if $PROJECT; then
  echo "  Scope:   project-local (.mcp.json + ./.claude/)"
else
  echo "  Scope:   user (~/.claude/skills/coder-workflow + ~/.claude.json)"
fi
echo "  MCP:     codegraph (stdio) → coder-workflow mcp"
echo "  CLI:     $(command -v coder-workflow 2>/dev/null || echo 'not on PATH — re-run install or add npm global bin to PATH')"
echo ""
echo -e "${BLUE}Active hooks (36 entries across 15 events):${NC}"
echo "  SessionStart   startup  → banner + graph status + async auto-scan"
echo "  SessionStart   resume   → graph age check + task-state reminder"
echo "  SessionStart   compact  → re-orientation notice"
echo "  SessionStart   clear    → session log cleanup"
echo "  PreToolUse     Bash     → rm-guard (blocks rm -rf /) + force-push-guard (blocks --force to main)"
echo "  PreToolUse     Bash     → git reset --hard warn + destructive SQL warn"
echo "  PreToolUse     Write    → env-write-guard (warns if .env* not gitignored)"
echo "  PostToolUse    Write/*  → bug tracking reminder + async graph update"
echo "  PostToolUse    Bash     → package install notice + commit log + test log"
echo "  PostToolUse    codegraph MCP → graph op log"
echo "  PostToolUseFailure *    → async failure log"
echo "  PostToolBatch           → async batch size log"
echo "  Stop                   → verification checklist + async graph update"
echo "  StopFailure    *       → rate-limit / token / server error guidance"
echo "  FileChanged    *       → package, .env, CLAUDE.md, hooks.json, tsconfig, .mcp.json watchers"
echo "  CwdChanged             → directory change + CodeGraph availability"
echo "  PostCompact    *       → re-orientation after compaction"
echo "  SubagentStart/Stop *   → async agent lifecycle log"
echo "  TaskCreated/Completed  → echo + async log"
echo "  InstructionsLoaded *   → async CLAUDE.md load log"
echo "  ConfigChange   *       → config source log"
echo "  SessionEnd     *       → session summary + log cleanup"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Restart Claude Code (or run /reload-plugins)"
echo "2. Start any coding task — /coder-workflow:coder-orchestrator is your entry point"
echo "3. To verify MCP: coder-workflow mcp  (Ctrl+C to stop)"
echo ""
