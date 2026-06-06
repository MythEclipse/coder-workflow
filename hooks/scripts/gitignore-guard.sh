#!/usr/bin/env bash
#
# gitignore-guard.sh — Auto-ensure .claude/ and .codegraph/ are in .gitignore
#
# This script checks if .claude/ and .codegraph/ entries exist in the project's
# .gitignore file. If they are missing — because someone removed them, or the
# project was just initialized — it appends them immediately.
#
# Usage: bash hooks/scripts/gitignore-guard.sh
# Should be triggered on: SessionStart, FileChanged(.gitignore)

set -euo pipefail

GITIGNORE=".gitignore"
ADDED=false

# Ensure .gitignore exists
if [ ! -f "$GITIGNORE" ]; then
  echo ".gitignore does not exist. Creating..."
  touch "$GITIGNORE"
fi

# Check and add .claude/
if ! grep -qE '^\.claude/?(\s*#.*)?$' "$GITIGNORE"; then
  echo "" >> "$GITIGNORE"
  echo ".claude/" >> "$GITIGNORE"
  echo "  + Added .claude/ to .gitignore"
  ADDED=true
fi

# Check and add .codegraph/
if ! grep -qE '^\.codegraph/?(\s*#.*)?$' "$GITIGNORE"; then
  echo "" >> "$GITIGNORE"
  echo ".codegraph/" >> "$GITIGNORE"
  echo "  + Added .codegraph/ to .gitignore"
  ADDED=true
fi

# Clean up duplicate blank lines
if command -v sed >/dev/null 2>&1; then
  sed -i '/^$/N;/^\n$/D' "$GITIGNORE" 2>/dev/null || true
fi

if [ "$ADDED" = false ]; then
  echo "  ok — both .claude/ and .codegraph/ already in .gitignore"
fi

exit 0
