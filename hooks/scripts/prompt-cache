#!/usr/bin/env bash
# prompt-cache.sh — detect repetitive prompts using MD5 hash matching
# Reads JSON from stdin. Stores prompt hashes in /tmp/cw-prompt-cache.jsonl
# If similar prompt seen before, outputs a reminder.
set -euo pipefail

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
[ -z "$PROMPT" ] && exit 0

CACHE_FILE="/tmp/cw-prompt-cache.jsonl"

# Generate prompt hash (first 200 chars for similarity, not exact match)
PROMPT_SNIPPET=$(printf '%s' "$PROMPT" | head -c 200 | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]\+/ /g' | xargs)
HASH=$(printf '%s' "$PROMPT_SNIPPET" | md5sum | cut -d' ' -f1)

# Ensure cache file exists
touch "$CACHE_FILE"

# Check for exact hash match (same prompt asked before)
MATCH_LINE=$(grep "^$HASH|" "$CACHE_FILE" 2>/dev/null | tail -1 || true)

if [ -n "$MATCH_LINE" ]; then
  PREV_COUNT=$(printf '%s' "$MATCH_LINE" | cut -d'|' -f2)
  PREV_TIME=$(printf '%s' "$MATCH_LINE" | cut -d'|' -f3)
  NEW_COUNT=$((PREV_COUNT + 1))

  # Update count in cache (sed replace)
  sed -i "s/^${HASH}|${PREV_COUNT}|${PREV_TIME}/${HASH}|${NEW_COUNT}|$(date -u +%H:%M:%S)/" "$CACHE_FILE" 2>/dev/null || true

  if [ "$NEW_COUNT" -ge 3 ]; then
    jq -n \
      --arg count "$NEW_COUNT" \
      --arg time "$PREV_TIME" \
      '{
        systemMessage: ("coder-workflow notice: this prompt has been asked \($count) times this session (first seen at \($time) UTC). If the previous answer was incomplete, rephrase with more specific constraints or add verification requirements.")
      }'
  fi
else
  # New prompt — add to cache
  printf '%s|1|%s\n' "$HASH" "$(date -u +%H:%M:%S)" >> "$CACHE_FILE"
fi

# --- Semantic similarity check: extract keywords and check for recent overlap ---
# Extract top 5 significant words (>=4 chars, no stopwords)
KEYWORDS=$(printf '%s' "$PROMPT_SNIPPET" | grep -oE '[a-z]{4,}' | grep -vE '^(this|that|with|from|have|been|were|will|would|should|could|does|what|when|where|which|there|their|about|after|before|between|through|during|without|toward|under|around|among|another|because|become|became|cannot|except|inside|outside|inside|within|into|upon|some|such|than|them|then|these|those|through|until|while|whenever|whether|which|while|whom|whose|would|could|should|your|from|make|made|take|want|need|also|just|only|into|over|many|much|more|most|some|such|than|them|very|when|will|with|work|does|done|going|each|made|make|well|back|even|part|down|show|point|after|other|over|last|first|look|used|find|here|give|most|used|going|know|large|must|name|seem|small|next|help|turn|problem|still|seem|might|begin|right|line|end|every|change|group|start|could|follow|might|right|great|between|around|small|however|before|developed|number|people|should|system|called|found|water|being|place|where|after|world|three|point|state|which|under|between|through|during|without|another|outside|inside|within|became|course|always|never|often|along|form|around|around|around|away|left|home|high|away|young|point|school|state|family|story|might|never|right|away|around|before|developed|another|however|number|people|system|called|would|could|should|great|great|great|small|place|place|world|world|world|still|still|still)$' | sort | uniq -c | sort -rn | head -5 | awk '{print $2}' | tr '\n' ',' | sed 's/,$//')

if [ -n "$KEYWORDS" ]; then
  # Check if the same keyword set appeared recently (last 10 prompts)
  RECENT_KEYWORDS=$(tail -10 "$CACHE_FILE" 2>/dev/null | cut -d'|' -f4 | tr ',' '\n' | sort -u | tr '\n' ',' | sed 's/,$//' || true)

  # Count overlap
  OVERLAP=0
  IFS=',' read -ra KW_ARRAY <<< "$KEYWORDS"
  for kw in "${KW_ARRAY[@]}"; do
    if printf '%s' "$RECENT_KEYWORDS" | grep -q "$kw" 2>/dev/null; then
      OVERLAP=$((OVERLAP + 1))
    fi
  done

  if [ "$OVERLAP" -ge 3 ] && [ "$OVERLAP" -eq "${#KW_ARRAY[@]}" ]; then
    # All keywords match a recent prompt — high similarity
    jq -n \
      --arg kw "$KEYWORDS" \
      '{
        systemMessage: ("coder-workflow notice: prompt keywords [\($kw)] match a recent request this session. If working on the same task, check active tasks before starting new work. If this is a new angle, specify how it differs.")
      }'
  fi

  # Append keywords to cache entry
  if [ -f "$CACHE_FILE" ]; then
    sed -i "s/^${HASH}|/${HASH}|/" "$CACHE_FILE" 2>/dev/null || true
    # Append keywords to the last matching line
    LAST_LINE=$(grep "^$HASH|" "$CACHE_FILE" | tail -1)
    if printf '%s' "$LAST_LINE" | grep -q '|[^|]*$' 2>/dev/null; then
      # Already has keywords field
      true
    else
      # Append keywords field
      sed -i "/^${HASH}|/ s/$/|${KEYWORDS}/" "$CACHE_FILE" 2>/dev/null || true
    fi
  fi
fi

exit 0
