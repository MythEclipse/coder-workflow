---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.
**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue: Test failures, Bugs in production, Unexpected behavior, Performance problems, Build failures.
**Use this ESPECIALLY when:** Under time pressure, "Just one quick fix" seems obvious, Previous fix didn't work.

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation
**BEFORE attempting ANY fix:**
1. **Read Error Messages Carefully**: Read stack traces completely. Note line numbers.
2. **Reproduce Consistently**: What are the exact steps? If not reproducible → gather more data, don't guess.
3. **Check Recent Changes**: Git diff, recent commits, environment.
4. **Gather Evidence in Multi-Component Systems**: Add diagnostic instrumentation (logging). See where data enters/exits.
5. **Trace Data Flow**: Where does bad value originate? Trace up until you find the source. Fix at source.

### Phase 2: Pattern Analysis
**Find the pattern before fixing:**
1. **Find Working Examples**: Similar working code in same codebase.
2. **Identify Differences**: What's different between working and broken?

### Phase 3: Hypothesis and Testing
**Scientific method:**
1. **Form Single Hypothesis**: State clearly: "I think X is the root cause because Y"
2. **Test Minimally**: Make the SMALLEST possible change to test hypothesis.
3. **Verify Before Continuing**: Did it work? Yes → Phase 4. Didn't work? Form NEW hypothesis. DON'T add more fixes on top.

### Phase 4: Implementation
**Fix the root cause, not the symptom:**
1. **Create Failing Test Case**: Simplest possible reproduction. MUST have before fixing. Use `test-driven-development` skill.
2. **Implement Single Fix**: ONE change at a time. No "while I'm here" improvements.
3. **Verify Fix**: Test passes now? Issue actually resolved?
4. **If Fix Doesn't Work**: STOP. If < 3 attempts: Return to Phase 1. If ≥ 3 attempts: STOP and question the architecture.

## Red Flags - STOP and Follow Process
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "I don't fully understand but this might work"
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals new problem in different place**

**ALL of these mean: STOP. Return to Phase 1.**

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |

## Final Note
95% of "no root cause" cases are incomplete investigation. Do the work.
