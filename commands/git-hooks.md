---
description: Scaffold git hooks with validation — pre-commit, pre-push, commit-msg
argument-hint: [hook-type-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(git-hooks-scaffold): Scaffold and validate git hooks

∴ Workflow({
  name: 'git-hooks-scaffold',
  description: 'Scaffold pre-commit, pre-push, commit-msg hooks with validation',
  phases: [
    { title: 'Audit',     detail: 'parallel: existing hooks + project conventions' },
    { title: 'Scaffold',  detail: 'generate hook scripts via CodeGraph tool' },
    { title: 'Verify',    detail: 'confirm hooks are executable + fire correctly' },
  ],
})

phase('Audit')
const [existingHooks, conventions] = await parallel([
  () => agent(
    `Check existing git hooks in .git/hooks/ and .husky/ or lefthook.yml.
    Report: which hooks exist, what they do, any gaps.`,
    { label: 'existing-hooks', phase: 'Audit', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Read project conventions from package.json scripts (lint, test, typecheck) and CLAUDE.md.
    Identify what validations should run at each hook stage.`,
    { label: 'conventions', phase: 'Audit', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Scaffold')
const hooks = await agent(
  `Run mcp__codegraph__scaffold_git_hooks for hook type: ${$ARGUMENTS || 'pre-commit + pre-push + commit-msg'}.
  Generate:
  - pre-commit: lint + typecheck (fast, blocks commit if fails)
  - pre-push: full test suite (slower, blocks push)
  - commit-msg: enforce conventional commits format
  Existing: ${existingHooks}
  Conventions: ${conventions}`,
  { label: 'scaffold-hooks', phase: 'Scaffold', agent: 'coder-workflow:explore-codebase' }
)

phase('Verify')
const verify = await agent(
  `Verify generated hooks:
  - Are all hook files executable (chmod +x)?
  - Do they reference valid commands from package.json scripts?
  - Test dry-run: simulate hook trigger
  Hooks: ${hooks}`,
  { label: 'hooks-verify', phase: 'Verify', agent: 'coder-workflow:explore-codebase' }
)

return { hooks, verify }
```
