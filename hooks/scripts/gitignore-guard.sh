#!/usr/bin/env bash
#
# gitignore-guard.sh — Auto-ensure .claude/ is in .gitignore
#
set -euo pipefail

GITIGNORE=".gitignore"
ADDED=false

if [ ! -f "$GITIGNORE" ]; then
  echo ".gitignore does not exist. Creating..."
  touch "$GITIGNORE"
fi

if ! grep -qE '^\.claude/?(\s*#.*)?$' "$GITIGNORE"; then
  echo "" >> "$GITIGNORE"
  echo ".claude/" >> "$GITIGNORE"
  echo "  + Added .claude/ to .gitignore"
  ADDED=true
fi

if command -v sed >/dev/null 2>&1; then
  sed -i '/^$/N;/^\n$/D' "$GITIGNORE" 2>/dev/null || true
fi

if [ "$ADDED" = false ]; then
  echo "  ok — .claude/ already in .gitignore"
fi

exit 0
