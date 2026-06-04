import * as fs from 'node:fs';
import * as path from 'node:path';

export type HookType = 'pre-commit' | 'commit-msg' | 'pre-push' | 'post-commit' | 'post-merge';

export interface HookConfig {
  hooks: HookType[];
  linter?: string;
  testCommand?: string;
  requireConventionalCommit?: boolean;
  branchPattern?: string;
}

export interface ScaffoldResult {
  hooksCreated: number;
  existingSkipped: number;
  files: string[];
}

const CONVENTIONAL_COMMIT_REGEX = /^(feat|fix|chore|docs|refactor|test|style|perf|ci|build|revert)(\(.+\))?!?:\s.+/;

export const HOOK_TEMPLATES: Record<HookType, string> = {
  'pre-commit': `#!/bin/sh
# Pre-commit hook — run linter on staged files
set -e

LINTER="{{LINTER}}"

if [ -z "$LINTER" ]; then
  exit 0
fi

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\\.(js|ts|jsx|tsx|vue|svelte)$' || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "Running $LINTER on staged files..."

# shellcheck disable=SC2086
$LINTER $STAGED_FILES

if [ $? -ne 0 ]; then
  echo "Linting failed. Please fix the errors before committing."
  exit 1
fi

echo "Linting passed."
exit 0
`,
  'commit-msg': `#!/bin/sh
# Commit-msg hook — validate conventional commit message
set -e

COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

if echo "$COMMIT_MSG" | grep -qE '^(fixup!|squash!|Merge|merge)'; then
  exit 0
fi

if ! echo "$COMMIT_MSG" | grep -qE '^(feat|fix|chore|docs|refactor|test|style|perf|ci|build|revert)(\\(.+\\))?!?:\\s.+'; then
  echo ""
  echo "  ERROR: Invalid commit message format."
  echo ""
  echo "  Conventional commit format required:"
  echo "    feat(scope): message"
  echo "    fix: message"
  echo "    chore(scope)!: breaking change"
  echo ""
  echo "  Allowed types: feat, fix, chore, docs, refactor, test, style, perf, ci, build, revert"
  echo ""
  exit 1
fi

exit 0
`,
  'pre-push': `#!/bin/sh
# Pre-push hook — run tests before push
set -e

TEST_CMD="{{TEST_COMMAND}}"

if [ -z "$TEST_CMD" ]; then
  exit 0
fi

BRANCH_PATTERN="{{BRANCH_PATTERN}}"

if [ -n "$BRANCH_PATTERN" ]; then
  CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if echo "$CURRENT_BRANCH" | grep -qE "$BRANCH_PATTERN"; then
    echo "Branch '$CURRENT_BRANCH' matches skip pattern. Skipping tests."
    exit 0
  fi
fi

echo "Running tests before push..."

# shellcheck disable=SC2086
$TEST_CMD

if [ $? -ne 0 ]; then
  echo "Tests failed. Push aborted."
  exit 1
fi

echo "All tests passed."
exit 0
`,
  'post-commit': `#!/bin/sh
# Post-commit hook — success notification
set -e

COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
COMMIT_MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")

echo ""
echo "  Commit successful: $COMMIT_HASH"
echo "  $COMMIT_MSG"
echo ""
exit 0
`,
  'post-merge': `#!/bin/sh
# Post-merge hook — npm install reminder
set -e

CHANGED=$(git diff HEAD@{1} --name-only 2>/dev/null || echo "")

if echo "$CHANGED" | grep -qE '(package\\.json|package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml)'; then
  echo ""
  echo "  Dependencies changed. Run 'npm install' (or your package manager) to update."
  echo ""
fi

exit 0
`,
};

function substituteVars(template: string, config: HookConfig): string {
  return template
    .replace('{{LINTER}}', config.linter ?? '')
    .replace('{{TEST_COMMAND}}', config.testCommand ?? '')
    .replace('{{BRANCH_PATTERN}}', config.branchPattern ?? '');
}

function writeHookFile(hookPath: string, content: string): void {
  fs.writeFileSync(hookPath, content, { encoding: 'utf-8', mode: 0o755 });
}

/**
 * Detect which of the specified hooks already exist in the target .git/hooks directory
 * and would be overwritten.
 */
export function detectExistingHooks(targetDir: string, hooks: HookType[]): HookType[] {
  const gitHooksDir = path.join(targetDir, '.git', 'hooks');

  if (!fs.existsSync(gitHooksDir)) {
    return [];
  }

  return hooks.filter((hook) => {
    const hookFilePath = path.join(gitHooksDir, hook);
    return fs.existsSync(hookFilePath);
  });
}

/**
 * Validate a commit message against the conventional commit format.
 * Allowed types: feat, fix, chore, docs, refactor, test, style, perf, ci, build, revert.
 * Optional scope in parentheses, optional breaking (!) marker, then ": " followed by description.
 */
export function validateCommitMessage(message: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const trimmed = message.trim();

  if (!trimmed) {
    return { valid: false, errors: ['Commit message is empty.'] };
  }

  const firstLine = trimmed.split('\n')[0] ?? '';

  // Allow fixup!, squash!, Merge, and merge commit messages
  if (/^(fixup!|squash!|Merge|merge)/.test(firstLine)) {
    return { valid: true, errors: [] };
  }

  if (!CONVENTIONAL_COMMIT_REGEX.test(firstLine)) {
    errors.push(
      `Commit message does not follow conventional commit format.

Expected: <type>(<scope>)!: <description>

Allowed types: feat, fix, chore, docs, refactor, test, style, perf, ci, build, revert

Examples:
  feat(auth): add login endpoint
  fix: resolve null pointer in parser
  chore(deps)!: drop support for Node 16
  docs(api): update endpoint descriptions

Received:
  ${firstLine}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format a list of validation errors into a human-readable string for display.
 */
export function formatHookError(errors: string[]): string {
  if (errors.length === 0) {
    return '';
  }

  const lines: string[] = ['Hook validation failed with the following errors:', ''];

  for (const err of errors) {
    lines.push(`  - ${err}`);
  }

  lines.push('', 'Commit aborted.');

  return lines.join('\n');
}

/**
 * Scaffold git hook files from templates into the target project's .git/hooks/ directory.
 * Only installs hooks listed in config.hooks. Existing hooks with matching names are
 * overwritten (they are counted, and the count is returned in existingSkipped).
 *
 * Each hook file is made executable (chmod +x).
 *
 * Returns a ScaffoldResult with the number of hooks created, number of existing ones
 * skipped (i.e., overwritten), and the list of file paths written.
 */
export function scaffoldHooks(targetDir: string, config: HookConfig): ScaffoldResult {
  const gitHooksDir = path.join(targetDir, '.git', 'hooks');

  // Ensure the .git/hooks directory exists
  if (!fs.existsSync(gitHooksDir)) {
    throw new Error(`Git hooks directory not found: ${gitHooksDir}. Is this a git repository?`);
  }

  const existingHooks = detectExistingHooks(targetDir, config.hooks);
  const files: string[] = [];
  const skipSet = new Set(existingHooks);

  for (const hook of config.hooks) {
    const hookPath = path.join(gitHooksDir, hook);
    const template = HOOK_TEMPLATES[hook];

    if (!template) {
      // Should not happen given the HookType constraint, but guard defensively
      continue;
    }

    const content = substituteVars(template, config);
    writeHookFile(hookPath, content);
    files.push(hookPath);
  }

  const hooksCreated = files.length;
  const existingSkipped = skipSet.size;

  return { hooksCreated, existingSkipped, files };
}
