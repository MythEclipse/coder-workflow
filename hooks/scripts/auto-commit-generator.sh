#!/bin/bash
set -e

# Over-engineered static analysis commit generator
# Replaces lazy template mapping with dynamic diff-to-conventional-commit synthesis.

INPUT=$(cat 2>/dev/null || echo "{}")
TITLE=$(jq -r ".task.title // .title // empty" <<< "$INPUT")
SUMMARY=$(jq -r ".task.summary // .task.description // empty" <<< "$INPUT")

if [ -z "$TITLE" ]; then
    echo "coder-workflow: No task title provided in payload. Falling back to semantic diff analysis."
    TITLE="update components based on recent changes"
fi

# 1. Analyze staged files to calculate scope and type
STAGED_FILES=$(git diff --cached --name-only)

if [ -z "$STAGED_FILES" ]; then
    echo "coder-workflow: No staged files to commit."
    exit 0
fi

TYPE="chore"
SCOPE=""

# Heuristic static analysis for type
if echo "$STAGED_FILES" | grep -qE "^src/|^lib/|^app/"; then
    TYPE="feat"
    if echo "$TITLE" | grep -qiE "fix|bug|resolve|patch"; then TYPE="fix"; fi
    if echo "$TITLE" | grep -qiE "refactor|cleanup|architect"; then TYPE="refactor"; fi
elif echo "$STAGED_FILES" | grep -qE "test/|\.spec\.|\.test\."; then
    TYPE="test"
elif echo "$STAGED_FILES" | grep -qE "\.md$|docs/"; then
    TYPE="docs"
elif echo "$STAGED_FILES" | grep -qE "Dockerfile|\.github/|\.gitlab|Makefile"; then
    TYPE="ci"
fi

# Heuristic static analysis for scope (find most common root directory)
TOP_DIR=$(echo "$STAGED_FILES" | awk -F'/' '{print $1}' | sort | uniq -c | sort -nr | head -n 1 | awk '{print $2}')
if [ -n "$TOP_DIR" ] && [ "$TOP_DIR" != "." ] && [ "$TOP_DIR" != "src" ]; then
    SCOPE="($TOP_DIR)"
elif echo "$STAGED_FILES" | grep -q "package.json"; then
    SCOPE="(deps)"
fi

# 2. Sanitize and lowercase TITLE for Conventional Commits
CLEAN_TITLE=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/\.$//' | sed -E 's/^(fix|feat|chore|docs|refactor|test)(: | )//i')

# 3. Construct the generated message
COMMIT_MSG="${TYPE}${SCOPE}: ${CLEAN_TITLE}"

if [ -n "$SUMMARY" ] && [ "$SUMMARY" != "null" ]; then
    COMMIT_MSG="${COMMIT_MSG}\n\n${SUMMARY}"
fi

# Attach diff stat summary for context integrity
DIFF_STAT=$(git diff --cached --stat | head -n 10)
COMMIT_MSG="${COMMIT_MSG}\n\nChanges:\n${DIFF_STAT}"

# 4. Execute Commit
echo -e "$COMMIT_MSG" > .git/COMMIT_EDITMSG_AUTO
git commit -F .git/COMMIT_EDITMSG_AUTO
rm -f .git/COMMIT_EDITMSG_AUTO

echo "coder-workflow: Granular commit synthesized and applied natively."
