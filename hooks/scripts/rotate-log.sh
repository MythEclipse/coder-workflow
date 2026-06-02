#!/usr/bin/env bash
# Log rotation helper — truncates/rotates session log file if it exceeds max size.
# Called by hook scripts before appending to session logs.
# Usage: rotate_log <log_path> <max_bytes>

set -e

log_path="${1:?log path required}"
max_bytes="${2:-10485760}"  # default 10 MB

if [ ! -f "$log_path" ]; then
  exit 0
fi

# macOS/BSD-compatible stat
if stat --version 2>/dev/null | grep -q GNU; then
  size=$(stat -c%s "$log_path" 2>/dev/null || echo 0)
else
  size=$(stat -f%z "$log_path" 2>/dev/null || echo 0)
fi

if [ "$size" -gt "$max_bytes" ]; then
  timestamp=$(date +%Y%m%d-%H%M%S)
  rotated="${log_path}.${timestamp}"

  # Keep second half of file (most recent entries)
  lines=$(wc -l < "$log_path")
  half=$((lines / 2))
  tail -n "$half" "$log_path" > "$rotated"

  # Start fresh with recent entries
  mv "$rotated" "$log_path"

  # Cleanup old rotations beyond 3
  ls -t "${log_path}".* 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null || true

  echo "[$(date -u +%T)] LOG ROTATED: was ${size} bytes, trimmed to half" >> "$log_path"
fi
