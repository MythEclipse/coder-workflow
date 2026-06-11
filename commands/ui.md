---
description: Frontend UI — React/Vue components, CSS, accessibility, state management
argument-hint: [component-or-scope]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T2] → Workflow(ui-component-build): UI component build with a11y + state management

∴ Workflow({
  name: 'ui-component-build',
  description: 'Build/refactor UI components: React/Vue, CSS, accessibility, state',
  phases: [
    { title: 'Discover',  detail: 'map existing component tree + design tokens + a11y state' },
    { title: 'Build',     detail: 'parallel: component impl + styles + state + a11y tests' },
    { title: 'Verify',    detail: 'a11y audit + visual regression check' },
  ],
})

phase('Discover')
const [componentMap, designSystem] = await parallel([
  () => agent(
    `Map current component tree, identify reuse opportunities, find a11y violations.
    Scope: ${$ARGUMENTS || 'full frontend'}. Use CodeGraph to trace component dependencies.`,
    { label: 'component-map', phase: 'Discover', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Extract design tokens: colors, spacing, typography, breakpoints from existing CSS/theme files.
    Identify any inconsistencies or missing tokens.`,
    { label: 'design-system', phase: 'Discover', agent: 'coder-workflow:ui-engineer' }
  ),
])

phase('Build')
const [componentResult, stylesResult, stateResult] = await parallel([
  () => agent(
    `Implement UI component(s) for: $ARGUMENTS
    Requirements: semantic HTML, ARIA attributes, keyboard navigation, focus management.
    Component tree: ${componentMap}`,
    { label: 'component-impl', phase: 'Build', agent: 'coder-workflow:ui-engineer' }
  ),
  () => agent(
    `Implement CSS/styles for: $ARGUMENTS
    Use existing design tokens: ${designSystem}
    No inline styles. Follow BEM or existing naming convention.`,
    { label: 'styles-impl', phase: 'Build', agent: 'coder-workflow:ui-engineer' }
  ),
  () => agent(
    `Implement state management for: $ARGUMENTS
    Follow existing patterns (Redux/Zustand/Pinia/Composables).
    Component tree context: ${componentMap}`,
    { label: 'state-impl', phase: 'Build', agent: 'coder-workflow:ui-engineer' }
  ),
])

phase('Verify')
const a11yAudit = await agent(
  `Audit implemented components for accessibility:
  - WCAG 2.1 AA compliance
  - Screen reader compatibility
  - Keyboard navigation completeness
  - Color contrast ratios
  Built: ${[componentResult, stylesResult, stateResult].map(r => r.label).join(', ')}`,
  { label: 'a11y-verify', phase: 'Verify', agent: 'coder-workflow:ui-engineer' }
)

return { a11yAudit, componentsBuilt: 1 }
```

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Use standard `view_file` or `Read` instead.
