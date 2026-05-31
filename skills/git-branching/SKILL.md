---
name: git-branching
description: "Use when starting a new implementation task to isolate state. Creates and manages Git branches for features or fixes."
---

# Git Branching for State Isolation

## Overview

Always use isolated Git branches for implementation work. Never execute modifying tasks directly on `main` or `master` to ensure atomicity, safe rollbacks, and clean history.

## The Iron Law

```
NO IMPLEMENTATION ON MAIN BRANCH. ALWAYS CHECKOUT A NEW BRANCH.
```

## When to Use

- **Immediately after `workflow-planner`** creates the implementation plan.
- **Before `code-implementer`** executes any file modifications.
- **When starting a bug fix** outside the immediate scope of a current branch.

## The Process

### 1. Verification
Before branching, verify the current branch and state:
```bash
git status
git branch --show-current
```
- If there are uncommitted changes that belong to another task, commit or stash them.
- Ensure you are branching from an up-to-date base (e.g., `main`).

### 2. Branch Naming
Determine a clear, concise branch name based on the task:
- For features: `feature/<task-name>`
- For bug fixes: `fix/<bug-name>`
- For refactoring: `refactor/<module-name>`

### 3. Creation
Create and checkout the branch:
```bash
git checkout -b <branch-name>
```

### 4. Implementation
Once the branch is created, proceed with the `code-implementer` phase using strict TDD (`test-driven-development`).

### 5. Completion & Cleanup
After the two-stage review passes and the feature/fix is complete:
1. Ensure all tests pass.
2. Commit the final changes.
3. If instructed by the user, merge back to the base branch and delete the feature branch. Otherwise, leave it for user review.

## Red Flags - STOP
- Attempting to write code on `main`.
- Branch name is vague (e.g., `test`, `fix2`).
- Working tree is dirty before branching.
