#!/usr/bin/env bash
# intent-classifier.sh — classify user prompt intent, pass structured context to orchestrator
# Reads JSON from stdin. Outputs a systemMessage with intent classification metadata.
set -euo pipefail

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
[ -z "${PROMPT:-}" ] && exit 0

LOWER=$(printf '%s' "$PROMPT" | tr '[:upper:]' '[:lower:]')

# ============================================================
# Intent keyword counting — each line: pattern → intent → weight
# Uses grep -oiE to count matches (not -c which counts lines with matches)
# ============================================================

declare -A SCORES=(
  [implement]=0 [fix]=0 [refactor]=0 [audit]=0 [deploy]=0
  [explore]=0 [test]=0 [plan]=0 [ask]=0 [config]=0
)

# count_matches PATTERN → returns number of word-boundary matches
count_matches() {
  local n
  n=$(printf '%s' "$LOWER" | grep -oiE "\b($1)\b" 2>/dev/null | wc -l | tr -d ' ') || n=0
  echo "$n"
}

# Add score to an intent
add_score() {
  local intent="$1" count="$2"
  SCORES[$intent]=$(( ${SCORES[$intent]} + count ))
}

# --- implement signals ---
add_score implement "$(count_matches 'implement|implementation|create|add|build|develop|make|finish|implementasi|buat|bikin|tambahkan|tambah|kerjakan|kerja|nambahin|nambah')"
add_score implement "$(count_matches 'endpoint|route|handler|controller|component|api|function|class|module')"

# --- fix signals ---
add_score fix "$(count_matches 'fix|bugfix|hotfix|patch|repair|solve|resolve|debug|troubleshoot|perbaiki|benahi')"
add_score fix "$(count_matches 'bug|error|crash|broken|fail|failed|not working|gagal|issue|wrong')"

# --- refactor signals ---
add_score refactor "$(count_matches 'refactor|refactoring|reorganize|restructure|extract|modular|modularize|rewrite|rework|cleanup|clean up')"
add_score refactor "$(count_matches 'mvc|layer.*separation|layer separation|pisah.*layer|susun ulang|struktur ulang|rapikan')"

# --- audit signals ---
add_score audit "$(count_matches 'audit|review|assess|evaluate|inspect|analyze|analisis|analisa')"
add_score audit "$(count_matches 'layer violation|fat controller|coupling|circular dependency|code smell')"

# --- deploy signals ---
add_score deploy "$(count_matches 'deploy|deployment|docker|traefik|vps|ci/cd|github action|container|production server')"
add_score deploy "$(count_matches 'compose|nginx|ghcr|containerize|dockerize|dockerisasi|publikasikan|server production')"

# --- explore signals ---
add_score explore "$(count_matches 'explore|scan.*code|build.*graph|refresh.*graph|map.*codebase|find.*definition|find.*caller|where.*defined')"
add_score explore "$(count_matches 'codegraph|dependency graph|call graph|impact analysis|blast radius|peta.*kode|graf.*kode')"

# --- test signals ---
add_score test "$(count_matches 'test|testing|unit test|integration test|e2e|coverage|mock|stub|assert|tdd|bdd')"
add_score test "$(count_matches 'uji.*unit|uji.*integrasi|pengujian|tes.*otomatis|buat.*pengujian')"

# --- plan signals ---
add_score plan "$(count_matches 'plan|planning|roadmap|decompose|break.*down|step.*by.*step|strategy|steps')"
add_score plan "$(count_matches 'rencana|pecah.*task|pecah.*tugas|tahapan|langkah|strategi|baiknya.*bagaimana')"

# --- ask signals (informational) ---
add_score ask "$(count_matches '^what is |^how does |^why |^explain |^describe |^tell me about |^can you explain')"
add_score ask "$(count_matches 'apa itu|jelaskan|bagaimana cara|kenapa|mengapa|kapan|dimana|siapa|cara kerja|maksudnya|perbedaan|arti dari')"

# --- config signals ---
add_score config "$(count_matches 'config|setup|install|init|environment|setting|permission|hook')"

# ============================================================
# Determine primary and secondary intents
# ============================================================
PRIMARY=""
PRIMARY_SCORE=0
SECONDARY=""
SECONDARY_SCORE=0

for intent in "${!SCORES[@]}"; do
  score=${SCORES[$intent]}
  if [ "$score" -gt "$PRIMARY_SCORE" ]; then
    SECONDARY=$PRIMARY
    SECONDARY_SCORE=$PRIMARY_SCORE
    PRIMARY=$intent
    PRIMARY_SCORE=$score
  elif [ "$score" -gt "$SECONDARY_SCORE" ]; then
    SECONDARY=$intent
    SECONDARY_SCORE=$score
  fi
done

# Confidence calculation
TOTAL=0
for s in "${SCORES[@]}"; do TOTAL=$((TOTAL + s)); done
if [ "$TOTAL" -gt 0 ]; then
  CONFIDENCE=$(( (PRIMARY_SCORE * 100) / TOTAL ))
else
  CONFIDENCE=0
fi

# ============================================================
# Complexity estimation from prompt length and keywords
# ============================================================
WORD_COUNT=$(printf '%s' "$PROMPT" | wc -w | tr -d ' ')
COMPLEXITY="simple"
[ "$WORD_COUNT" -gt 50 ] && COMPLEXITY="standard"
[ "$WORD_COUNT" -gt 150 ] && COMPLEXITY="complex"
if printf '%s' "$LOWER" | grep -qiE "\b(multi|architecture|migration|platform|scalab|distribut|event.*driven)\b"; then
  COMPLEXITY="complex"
fi

# ============================================================
# Language detection (Indonesian vs English)
# ============================================================
LANG="en"
if printf '%s' "$LOWER" | grep -qE '(kerjakan|implementasi|perbaiki|buat|tambah|apa itu|bagaimana|jelaskan|cara|fitur|kode|file|saya|kita|tolong|mohon|bisa|tidak|sudah|belum|sedang|akan|dari|untuk|dengan|pada|yang|ini|itu)'; then
  LANG="id"
fi

# ============================================================
# Output systemMessage
# ============================================================
if [ -n "$PRIMARY" ] && [ "$PRIMARY_SCORE" -gt 0 ]; then
  jq -n \
    --arg primary "$PRIMARY" \
    --arg secondary "$SECONDARY" \
    --arg confidence "$CONFIDENCE" \
    --arg complexity "$COMPLEXITY" \
    --arg lang "$LANG" \
    --arg words "$WORD_COUNT" \
    '{
      systemMessage: ("coder-workflow intent classified — primary: \($primary) (confidence: \($confidence)%), secondary: \($secondary), complexity: \($complexity), language: \($lang), words: \($words). Use this to right-size agent chain: simple→direct, standard→light review, complex→full SDD.")
    }'
fi

exit 0
