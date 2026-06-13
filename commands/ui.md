---
description: Frontend UI — React/Vue components, CSS, accessibility, state management
argument-hint: [component-or-scope]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, mcp__code-review-graph__*
---

When asked to run this command, write a native workflow script (`ultracode:`) to execute the following phases:

```markdown
### Phase: Discover
Run concurrently:
  - Map current component tree, identify reuse opportunities, find a11y violations. Scope: [results from previous phase]. Use Graph-based MCP tools to trace component dependencies.,
  - Extract design tokens: colors, spacing, typography, breakpoints from existing CSS/theme files. Identify any inconsistencies or missing tokens.,

### Phase: Build
Run concurrently:
  - Implement UI component(s) for: $ARGUMENTS Requirements: semantic HTML, ARIA attributes, keyboard navigation, focus management. Component tree: [results from previous phase],
  - Implement CSS/styles for: $ARGUMENTS Use existing design tokens: [results from previous phase] No inline styles. Follow BEM or existing naming convention.,
  - Implement state management for: $ARGUMENTS Follow existing patterns (Redux/Zustand/Pinia/Composables). Component tree context: [results from previous phase],

### Phase: Verify
- Audit implemented components for accessibility: - WCAG 2.1 AA compliance - Screen reader compatibility - Keyboard navigation completeness - Color contrast ratios Built: [results from previous phase]

```

