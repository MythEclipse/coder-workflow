#!/usr/bin/env bash
set -euo pipefail
LOG=".claude/session-$(date +%Y%m%d).log"
mkdir -p .claude 2>/dev/null || true
EVENT="${1:-unknown}"
DETAIL="${2:-}"
if [ -f "$LOG" ]; then
  SIZE=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 10485760 ]; then
    tail -n +500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null || true
  fi
fi
printf "[%s] %s: %s\n" "$(date -u +%T)" "$EVENT" "$DETAIL" >> "$LOG" 2>/dev/null || true
