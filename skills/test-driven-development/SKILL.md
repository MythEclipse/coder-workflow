---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## When to Use

**Always:**
- New features
- Bug fixes
- Refactoring
- Behavior changes

Thinking "skip TDD just this once"? Stop. That's rationalization.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Delete means delete

## Red-Green-Refactor

### RED - Write Failing Test
Write one minimal test showing what should happen. Clear name, tests real behavior, one thing.

### Verify RED - Watch It Fail
**MANDATORY. Never skip.**
Execute the test command. Confirm:
- Test fails (not errors)
- Failure message is expected
- Fails because feature missing (not typos)

### GREEN - Minimal Code
Write simplest code to pass the test. Just enough to pass. Don't add features, refactor other code, or "improve" beyond the test.

### Verify GREEN - Watch It Pass
**MANDATORY.**
Execute the test command. Confirm:
- Test passes
- Other tests still pass
- Output pristine (no errors, warnings)

### REFACTOR - Clean Up
After green only: Remove duplication, improve names, extract helpers. Keep tests green.

## Why Order Matters

**"I'll write tests after to verify it works"**
Tests written after code pass immediately. Passing immediately proves nothing: Might test wrong thing, might test implementation not behavior.

**"I already manually tested all the edge cases"**
Manual testing is ad-hoc. Automated tests are systematic.

**"Deleting X hours of work is wasteful"**
Sunk cost fallacy. Working code without real tests is technical debt.

## Red Flags - STOP and Start Over

- Code before test
- Test after implementation
- Test passes immediately
- Can't explain why test failed
- "Keep as reference" or "adapt existing code"
- "TDD is dogmatic, I'm being pragmatic"

**All of these mean: Delete code. Start over with TDD.**

## Verification Checklist

Before marking work complete:
- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Tests use real code (mocks only if unavoidable)

Can't check all boxes? You skipped TDD. Start over.

## Final Rule

```
Production code → test exists and failed first
Otherwise → not TDD
```

No exceptions without your human partner's permission.


---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**
