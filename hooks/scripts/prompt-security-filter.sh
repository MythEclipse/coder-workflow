#!/usr/bin/env bash
# prompt-security-filter.sh — detect destructive intent in user prompt before agent sees it
# Reads JSON from stdin. Outputs systemMessage with warning if dangerous patterns detected.
set -euo pipefail

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
[ -z "$PROMPT" ] && exit 0

LOWER=$(printf '%s' "$PROMPT" | tr '[:upper:]' '[:lower:]')

WARNINGS=()
SEVERITY="low"

# --- Destructive file operations ---
if printf '%s' "$LOWER" | grep -qiE '(hapus semua file|delete all files|rm -rf /[^t]|rm -rf ~|hapus.*semua.*direktori|wipe.*filesystem|format.*disk)'; then
  WARNINGS+=("Destructive file operation detected: prompt appears to target system-wide file deletion")
  SEVERITY="critical"
fi

# --- Destructive git operations ---
if printf '%s' "$LOWER" | grep -qiE '(force push.*main|force push.*master|push.*-f.*main|push.*-f.*master|push.*--force.*main|push.*--force.*master|reset.*main.*--hard|reset.*master.*--hard|hapus.*git|delete.*git.*history)'; then
  WARNINGS+=("Destructive git operation detected: force-push or hard-reset to main/master is blocked by safety guard")
  SEVERITY="critical"
fi

# --- Destructive database operations ---
if printf '%s' "$LOWER" | grep -qiE '(drop.*all.*table|drop.*database.*prod|drop.*database.*production|truncate.*all|hancurkan.*database|hapus.*semua.*data|drop.*schema.*cascade.*prod)'; then
  WARNINGS+=("Destructive database operation detected: confirm this targets dev/test, not production")
  SEVERITY="critical"
fi

# --- Secret/credential exposure ---
if printf '%s' "$LOWER" | grep -qiE '(print.*env.*token|echo.*password|cat.*\.env|commit.*secret|commit.*credential|commit.*api.key|commit.*private.key|upload.*secret)'; then
  WARNINGS+=("Secret exposure detected: prompt suggests printing or committing credentials. Verify .gitignore before proceeding")
  SEVERITY="high"
fi

# --- Mass deletion ---
if printf '%s' "$LOWER" | grep -qiE '(hapus.*semua.*branch|delete all branch|hapus.*semua.*tag|delete.*all.*tag|clean.*-fd|clean.*-fdx)'; then
  WARNINGS+=("Mass deletion detected: verify intent before executing bulk branch/tag cleanup")
  SEVERITY="high"
fi

# --- Production targeting ---
if printf '%s' "$LOWER" | grep -qiE '(deploy.*to.*prod|push.*production|live.*server|production.*database|reset.*production|migrate.*prod)'; then
  WARNINGS+=("Production targeting detected: confirm environment before deploying or modifying production")
  SEVERITY="high"
fi

# --- Overly broad changes ---
if printf '%s' "$LOWER" | grep -qiE '(replace.*all.*file|rewrite.*everything|hapus.*semua.*kode|delete.*all.*code|ganti.*semua.*implementasi)'; then
  WARNINGS+=("Overly broad change detected: suggest scoping to specific files/modules before bulk replacement")
  SEVERITY="medium"
fi

# --- Self-harm / recursion traps ---
if printf '%s' "$LOWER" | grep -qiE '(delete.*yourself|hapus.*diri|hancurkan.*semua.*hook|delete.*all.*hook|remove.*all.*skill|hapus.*semua.*skill)'; then
  WARNINGS+=("Self-destruct pattern detected: removing hooks/skills will break the workflow. Confirm intent")
  SEVERITY="high"
fi

# ============================================================
# Output
# ============================================================
if [ ${#WARNINGS[@]} -gt 0 ]; then
  # Join all warnings
  WARNING_TEXT=$(printf '%s\n' "${WARNINGS[@]}" | head -3 | tr '\n' ' ')

  jq -n \
    --arg severity "$SEVERITY" \
    --arg warning "$WARNING_TEXT" \
    '{
      systemMessage: ("⚠️  coder-workflow security filter [severity: \($severity)] — \($warning). Confirm before proceeding. This is a pre-flight safety check, not a block.")
    }'
fi

exit 0
