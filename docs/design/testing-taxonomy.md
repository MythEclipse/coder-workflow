# Testing Taxonomy

Full reference for test-engineer's domain knowledge. See `agents/test-engineer.md` for process and TDD cycle.

## Core Taxonomy

### Test Pyramid

| Layer | Proportion | Characteristics |
|-------|-----------|-----------------|
| Unit | ~70% | Fast (<10ms/test), in-memory, pure logic. No network/DB/filesystem. |
| Integration | ~20% | One real dependency (DB, API, filesystem). Setup/teardown per suite. |
| E2E | ~10% | Full system. Slow (>1s/test), brittle, must be minimized. |

Adjustments: API-heavy -> more integration tests. UI-heavy -> more E2E. Library/pure-logic -> almost 100% unit.

### Hierarchy of Test Needs (priority)

1. Business logic — calculations, validations, rule engine.
2. Error handling — invalid inputs, dependency downtime, timeouts.
3. Edge cases — null, empty, max, min, overflow, boundaries.
4. Happy path — obvious expected flow.
5. Security/auth — authentication, authorization, input sanitation.

---

## Essential Techniques

### Equivalence Partitioning (EP)
Divide input domain into equivalent classes. Test one value from each class. O(n) tests vs O(infinity).

### Boundary Value Analysis (BVA)
Errors concentrate at boundaries. Test at boundary, just above, just below. Combine with EP: EP provides classes, BVA provides values at edges.

### Pairwise Testing (All-Pairs)
Test parameter combinations without combinatorial explosion. 3 params x 5 values = 125 combos reduced to ~20-25 tests.

### State Transition Testing
For state machine-based systems. Coverage measured by: all-states, all-transitions, all-N-switches.

### Decision Table Testing
For complex boolean conditions. N conditions = 2^N rules. Practical up to ~4-5 conditions.

### Mutation Testing
True metric of test suite quality. Mutate code, run tests — surviving mutations = weak tests. Target mutation score >80%.

### Property-Based Testing
Test invariants with randomized inputs. Discovers edge cases unanticipated by EP. Tools: fast-check (JS/TS), Hypothesis (Python), QuickCheck (Haskell/Erlang).

---

## Patterns & Anti-patterns

| Good Practice | Anti-pattern | Why |
|---|---|---|
| Single logical assertion per test | Multiple assertions | First failure hides the rest |
| AAA: Arrange-Act-Assert | Setup mixed with assertions | Test logic unreadable |
| Test per behavior | Test per method | One method can have >1 behavior |
| Fake for internal dependencies | Mock everything | Rigid mocks break on impl changes |
| Quarantine flaky tests | Skip/delete flaky tests | Hidden until CI breaks again |
| Deterministic seed | Randomness without seeds | Cannot reproduce CI failures |

### FIRST Principles

- **F**ast — milliseconds. Network/DB = integration test.
- **I**solated — zero shared state. `beforeEach` > `beforeAll`.
- **R**epeatable — identical every execution. Deterministic seeds.
- **S**elf-validating — boolean pass/fail. No manual inspection.
- **T**imely — written before or alongside production code.

---

## Test Double Taxonomy (Meszaros)

| Double | Mechanism | When to Use | Example |
|--------|-----------|-------------|---------|
| **Dummy** | Passed along, never used | Satisfy constructor params | `new Logger(null)` |
| **Stub** | Returns canned answers | Control external inputs | `db.findUser() -> {id: 1}` |
| **Spy** | Records interactions | Verify side effects | Check sendEmail call count |
| **Mock** | Expects specific interactions | Behavior verification (external) | `expect(api.call).toHaveBeenCalledWith(x)` |
| **Fake** | Lightweight working implementation | Expensive internal deps | In-memory DB, fake filesystem |

**Rule of thumb**: Fakes for internal dependencies (repos, services). Mocks/Stubs exclusively for external boundaries (third-party APIs, message queues). Excessive mocking leads to brittle tests.

---

## Metrics & Heuristics

### Coverage Metrics (ranked by quality)
1. Line coverage — weakest. 100% can have zero fault detection.
2. Branch coverage — better. Is every if/else branch executed?
3. Condition coverage — even better. Every boolean evaluated to both T/F?
4. Mutation coverage — strongest. Can suite detect deliberate code changes?

### Practical Targets
- Branch coverage: >80% for business logic
- Mutation score: >70% for core logic
- Line coverage: treat as minimum threshold (>60% for new files)

### Gap Priority Heuristics
1. Files with zero tests — high risk
2. Files tested only for happy path — medium risk
3. Files with complex error handling (numerous catch/if blocks) — high risk
4. Files with McCabe cyclomatic complexity >10 — extensive testing needed
5. Files that change frequently — high regression risk

### Flaky Test Patterns

| Pattern | Characteristics | Fix |
|---------|----------------|------|
| Async timing | Fails 30% in CI, always green locally | Replace sleep(1000) with waitFor/retry |
| Shared mutable state | Fails if executed after test A | Reset state in beforeEach |
| Environment dependency | TZ=UTC vs local | Dockerize tests, set env explicitly |
| Order dependency | Fails only in full suite runs | Use --shuffle and --repeat |
| Random data | Seed varies per run | Log seed, reuse to reproduce |

**Fixing Strategy**: Quarantine flaky tests to isolated folder. Resolve root cause. Do not introduce new tests in same directory until remediated.
