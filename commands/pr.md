---
description: Generate PR description, changelog entry, and release notes from recent changes
argument-hint: [branch-or-tag-optional]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(pr-release-docs): PR description + changelog + release notes

∴ Workflow({
  name: 'pr-release-docs',
  description: 'Generate PR description, changelog, and release notes for: $ARGUMENTS',
  phases: [
    { title: 'Gather',  detail: 'parallel: git diff + commit log + issue refs + impact' },
    { title: 'Draft',   detail: 'parallel: PR description + changelog entry + release notes' },
    { title: 'Publish', detail: 'write files + optionally create GitHub PR via CLI' },
  ],
})

phase('Gather')
const [diffSummary, commitLog, impactAnalysis] = await parallel([
  () => agent(
    `Get git diff for: ${$ARGUMENTS || 'HEAD vs main'}.
    Summarize: files changed, lines added/removed, key changes by category.`,
    { label: 'diff-summary', phase: 'Gather', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Get commit log for: ${$ARGUMENTS || 'HEAD vs main'}.
    Extract: commit messages, authors, issue/ticket references (#NNN, JIRA-NNN).
    Run: git log --oneline --no-merges`,
    { label: 'commit-log', phase: 'Gather', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__analyze_impact on changed files for: ${$ARGUMENTS || 'HEAD vs main'}.
    Return: downstream impact, breaking change risk, API surface changes.`,
    { label: 'impact-analysis', phase: 'Gather', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Draft')
const [prDesc, changelog, releaseNotes] = await parallel([
  () => agent(
    `Generate PR description in GitHub markdown format:
    - Summary (2-3 sentences)
    - What changed (bullet list)
    - Why (motivation/context)
    - Breaking changes (if any)
    - Testing notes
    Diff: ${diffSummary}, Commits: ${commitLog}`,
    { label: 'pr-description', phase: 'Draft', agent: 'coder-workflow:docs-generator' }
  ),
  () => agent(
    `Generate CHANGELOG.md entry following Keep-a-Changelog format:
    ## [Unreleased] or ## [version] - date
    ### Added / Changed / Fixed / Breaking
    Diff: ${diffSummary}, Commits: ${commitLog}, Impact: ${impactAnalysis}`,
    { label: 'changelog', phase: 'Draft', agent: 'coder-workflow:docs-generator' }
  ),
  () => agent(
    `Generate release notes (user-facing, non-technical language):
    What's new, what's fixed, what to watch out for.
    Diff: ${diffSummary}, Commits: ${commitLog}`,
    { label: 'release-notes', phase: 'Draft', agent: 'coder-workflow:docs-generator' }
  ),
])

phase('Publish')
const published = await agent(
  `Write generated docs to disk:
  - PR description: .github/PULL_REQUEST_TEMPLATE/pr-draft.md (or print for copy-paste)
  - CHANGELOG.md: prepend new entry
  - RELEASE_NOTES.md: write or update
  PR: ${prDesc}
  Changelog: ${changelog}
  Release notes: ${releaseNotes}`,
  { label: 'publish-docs', phase: 'Publish', agent: 'coder-workflow:docs-generator' }
)

return { prDesc, changelog, releaseNotes, published }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
