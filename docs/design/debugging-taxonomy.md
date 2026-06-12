# Debugging Taxonomy

Full reference for debugging-engineer's domain knowledge. See `agents/debugging-engineer.md` for process and Scientific Method.

## Bug Taxonomy

### Based on Behavior

- **Bohrbug** — Deterministic bug. Occurs every time under same conditions. Easiest: reproduce, trace, fix.
- **Heisenbug** — Disappears when observed. Causes: race condition, timing, undefined behavior. Strategy: minimal logging, avoid debuggers altering execution, check data races and TOCTOU.
- **Mandelbug** — Complex chaotic causality. Requires exact combination of conditions. Strategy: delta debugging, systematic input reduction, binary search across conditions.
- **Schroedinbug** — Works until someone reads the code and realizes it shouldn't. Rarest.

### Based on Error Type

| Class | Example | Detection |
|-------|---------|-----------|
| Logic Error | Incorrect if condition, infinite loop | Code review, branch coverage |
| Semantic Error | API misunderstanding, wrong data type | Type checker, contract test |
| Syntactic Error | Incorrect syntax | Compiler/parser |
| Runtime Error | Null pointer, OOB, runtime type error | Crash trace, bounds checker |
| Race Condition | TOCTOU, data race, deadlock | Thread sanitizer, stress test |
| Memory Error | Use-after-free, double-free, OOM | Valgrind, ASan, UBSan |
| Off-by-One | Loop <= should be <, array index | Edge-case test, boundary analysis |

---

## Root Cause Analysis (RCA) Methods

### 1. 5 Whys (Iterative Causal Chain)
Ask "why" repeatedly until the fundamental root is found. Continue until causality stops.

### 2. Ishikawa / Fishbone Diagram
Categorize causes: Man (people), Machine (infra), Method (process), Material (data), Measurement (observability), Mother Nature (environment).

### 3. Pareto Analysis (80/20)
80% of failures from 20% of causes. Calculate frequency of each error pattern, focus on top 3.

### 4. Fault Tree Analysis (FTA)
Top-down deductive. Start from failure event, break into cause tree with AND/OR gates.

### 5. Rubber Duck Debugging
Explain code line by line to an inanimate object. The answer appears during verbalization.

---

## TOCTOU (Time-of-Check to Time-of-Use)

Classic race window: value is checked then used, but state changes between steps.

**Pattern**: check(A) -> [THREAD SWITCH] -> use(A) -> FAIL

Example: Check file exists -> someone deletes file -> read file -> crash.
Detection: look for check+use operation pairs without locking/synchronization.

---

## Patterns & Anti-patterns

### Patterns (Do this)
- **Isolate first** — create minimal reproduction separate from production code.
- **One change per experiment** — changing 3 things won't tell which solved it.
- **Write regression test first** — test that fails due to bug, then make it pass.
- **Log before assuming** — do not guess variable contents.
- **Check recent changes** — `git diff HEAD~5` is the most productive first step.

### Anti-patterns (Never do this)
- **"Let's just change X"** — change without hypothesis is blind guess.
- **"Quick fix first"** — creates debugging technical debt.
- **"One more fix attempt"** — if 2 fixes failed, STOP. Re-observe.
- **Modifying production code for debugging** — use feature flags.
- **Blaming compiler/runtime/library** — 99.9% of bugs in own code.

---

## Metrics & Heuristics

| Metric | Formula / Threshold | Purpose |
|--------|---------------------|---------|
| MTBF | Total uptime / crash count | System stability |
| MTTR | Total downtime / incident count | Team response speed |
| Bug Age | Current date - first report date | Triage priority |
| Crash Rate | Crashes / 1000 requests | Objective severity |
| Flaky Rate | Random pass-fail / total test runs | Test suite quality |
| Bisection Time | ceil(log2(N)) commits | Estimate of steps needed |

### Severity Classification

| Level | Criteria | SLA |
|-------|----------|-----|
| P0/Critical | Data loss, security breach, crashes all users | Fix < 1 hour |
| P1/High | Core feature broken, no workaround | Fix < 4 hours |
| P2/Medium | Feature broken, workaround exists | Fix < 24 hours |
| P3/Low | Cosmetic, rare edge case | Next sprint |
