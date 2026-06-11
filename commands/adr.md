---
description: Generate Architecture Decision Records (ADR) from existing decisions or new ones
argument-hint: [decision-topic]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(adr-generate): Generate Architecture Decision Record

∴ Workflow({
  name: 'adr-generate',
  description: 'Generate ADR for: $ARGUMENTS',
  phases: [
    { title: 'Research', detail: 'gather context: existing ADRs + code evidence + alternatives' },
    { title: 'Draft',    detail: 'docs-generator produces ADR in standard format' },
    { title: 'Register', detail: 'mcp__codegraph__adr_new saves ADR + updates graph' },
  ],
})

phase('Research')
const [existingAdrs, codeEvidence, alternatives] = await parallel([
  () => agent(
    `List all existing ADRs via mcp__codegraph__adr_list. Read the most related ones.
    Identify if a decision on this topic already exists.`,
    { label: 'existing-adrs', phase: 'Research', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Find code evidence supporting/contradicting the decision topic: $ARGUMENTS
    Use CodeGraph to trace implementation patterns, find the actual code that reflects decisions.`,
    { label: 'code-evidence', phase: 'Research', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Research alternatives for: $ARGUMENTS
    Identify: what other approaches were considered or could be considered.
    Look at git history, comments, and existing docs for clues.`,
    { label: 'alternatives', phase: 'Research', agent: 'coder-workflow:docs-generator' }
  ),
])

phase('Draft')
const adrDraft = await agent(
  `Write an Architecture Decision Record in MADR format:
  # ADR-NNN: [Title]
  ## Status: Proposed
  ## Context: [why this decision is needed]
  ## Decision: [what was decided]
  ## Consequences: [trade-offs, positive + negative]
  ## Alternatives Considered: [other options and why rejected]

  Topic: $ARGUMENTS
  Existing ADRs: ${existingAdrs}
  Code evidence: ${codeEvidence}
  Alternatives: ${alternatives}`,
  { label: 'adr-draft', phase: 'Draft', agent: 'coder-workflow:docs-generator' }
)

phase('Register')
const registered = await agent(
  `Save the ADR via mcp__codegraph__adr_new.
  Then update the ADR index/graph via mcp__codegraph__adr_graph.
  ADR content: ${adrDraft}`,
  { label: 'adr-register', phase: 'Register', agent: 'coder-workflow:docs-generator' }
)

return { adrDraft, registered }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
