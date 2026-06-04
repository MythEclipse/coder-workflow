import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  detectExistingHooks,
  formatHookError,
  scaffoldHooks,
  validateCommitMessage,
} from "../src/git-hooks.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "git-hooks-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("validateCommitMessage accepts valid feat: commit", () => {
  const result = validateCommitMessage("feat: add login endpoint");
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateCommitMessage accepts valid fix: commit", () => {
  const result = validateCommitMessage("fix: resolve null pointer in parser");
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateCommitMessage accepts valid feat(scope): commit", () => {
  const result = validateCommitMessage("feat(auth): add login endpoint");
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateCommitMessage accepts valid breaking commit with !", () => {
  const result = validateCommitMessage("chore(deps)!: drop support for Node 16");
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateCommitMessage rejects empty message", () => {
  const result = validateCommitMessage("");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("empty")));
});

test("validateCommitMessage rejects whitespace-only message", () => {
  const result = validateCommitMessage("   ");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("empty")));
});

test("validateCommitMessage rejects message without colon", () => {
  const result = validateCommitMessage("feat add login endpoint");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("conventional commit format")));
});

test("validateCommitMessage rejects message with bad type", () => {
  const result = validateCommitMessage("wtf: this is not a valid type");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("conventional commit format")));
});

test("validateCommitMessage rejects message with type but no subject after colon", () => {
  const result = validateCommitMessage("feat:");
  assert.equal(result.valid, false);
});

test("validateCommitMessage accepts fixup! and squash! prefixes", () => {
  const fixup = validateCommitMessage("fixup! feat: add login endpoint");
  assert.equal(fixup.valid, true);

  const squash = validateCommitMessage("squash! fix: resolve bug");
  assert.equal(squash.valid, true);
});

test("validateCommitMessage accepts Merge and merge prefixes", () => {
  const merge1 = validateCommitMessage("Merge branch 'main' into feature");
  assert.equal(merge1.valid, true);

  const merge2 = validateCommitMessage("merge: resolve conflicts");
  assert.equal(merge2.valid, true);
});

test("validateCommitMessage uses only first line for validation", () => {
  const result = validateCommitMessage(
    "feat: add login endpoint\n\nThis is a multi-line\ncommit body with details.",
  );
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateCommitMessage accepts all conventional commit types", () => {
  const types = [
    "feat", "fix", "chore", "docs", "refactor",
    "test", "style", "perf", "ci", "build", "revert",
  ];
  for (const type of types) {
    const result = validateCommitMessage(`${type}: add something`);
    assert.equal(result.valid, true, `Expected ${type} to be valid`);
  }
});

test("formatHookError returns empty string for empty errors array", () => {
  const output = formatHookError([]);
  assert.equal(output, "");
});

test("formatHookError formats single error", () => {
  const output = formatHookError(["Commit message is empty."]);
  assert.match(output, /Hook validation failed/);
  assert.match(output, /Commit message is empty/);
  assert.match(output, /Commit aborted/);
});

test("formatHookError formats multiple errors", () => {
  const output = formatHookError([
    "First error message.",
    "Second error message.",
  ]);
  assert.match(output, /First error message/);
  assert.match(output, /Second error message/);
});

test("scaffoldHooks throws when .git/hooks directory does not exist", () => {
  const root = fixture({});

  assert.throws(
    () => {
      scaffoldHooks(root, {
        hooks: ["pre-commit"],
      });
    },
    /Git hooks directory not found/,
  );
});

test("scaffoldHooks creates hook files in .git/hooks", () => {
  const root = fixture({});
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });

  const result = scaffoldHooks(root, {
    hooks: ["pre-commit", "commit-msg"],
  });

  assert.equal(result.hooksCreated, 2);
  assert.equal(result.files.length, 2);

  const preCommitPath = join(root, ".git", "hooks", "pre-commit");
  const commitMsgPath = join(root, ".git", "hooks", "commit-msg");
  assert.ok(result.files.includes(preCommitPath));
  assert.ok(result.files.includes(commitMsgPath));
});

test("scaffoldHooks substitutes linter variable in template", () => {
  const root = fixture({});
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });

  scaffoldHooks(root, {
    hooks: ["pre-commit"],
    linter: "biome check",
  });

  const content = readFileSync(
    join(root, ".git", "hooks", "pre-commit"),
    "utf-8",
  );
  assert.match(content, /biome check/);
});

test("scaffoldHooks substitutes test command and branch pattern in template", () => {
  const root = fixture({});
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });

  scaffoldHooks(root, {
    hooks: ["pre-push"],
    testCommand: "npm test",
    branchPattern: "^feature/",
  });

  const content = readFileSync(
    join(root, ".git", "hooks", "pre-push"),
    "utf-8",
  );
  assert.match(content, /npm test/);
  assert.match(content, /feature/);
});

test("detectExistingHooks returns empty array when no .git/hooks", () => {
  const root = fixture({});
  const existing = detectExistingHooks(root, ["pre-commit"]);
  assert.equal(existing.length, 0);
});

test("detectExistingHooks detects existing hooks", () => {
  const root = fixture({});
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });
  writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho old");

  const existing = detectExistingHooks(root, ["pre-commit", "commit-msg"]);
  assert.deepEqual(existing, ["pre-commit"]);
});

test("scaffoldHooks overwrites existing hooks and reports them as existingSkipped", () => {
  const root = fixture({});
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });
  writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho old");

  const result = scaffoldHooks(root, {
    hooks: ["pre-commit", "commit-msg"],
  });

  // Both created
  assert.equal(result.hooksCreated, 2);
  // pre-commit existed
  assert.equal(result.existingSkipped, 1);
});

test("scaffoldHooks creates post-commit and post-merge hooks", () => {
  const root = fixture({});
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });

  const result = scaffoldHooks(root, {
    hooks: ["post-commit", "post-merge"],
  });

  assert.equal(result.hooksCreated, 2);
  assert.ok(result.files.some((f) => f.endsWith("post-commit")));
  assert.ok(result.files.some((f) => f.endsWith("post-merge")));
});

test("validateCommitMessage rejects message with only a type and missing colon-space", () => {
  const result = validateCommitMessage("feat");
  assert.equal(result.valid, false);
});

test("validateCommitMessage rejects message with colon but no space", () => {
  const result = validateCommitMessage("feat:add something");
  assert.equal(result.valid, false);
});
