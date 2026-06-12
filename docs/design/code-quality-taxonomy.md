# Code Quality Taxonomy

Full reference for code-implementer's domain knowledge. See `agents/code-implementer.md` for core principles (SOLID, CQS, SLAP, Composition Over Inheritance, Rule of 3).

## Four Pillars of Code Quality

1. **Correctness** — The code does what it is supposed to do. Measured via test coverage and assertions.
2. **Maintainability** — How easily the code can be understood and modified. Measured via complexity, coupling, cohesion.
3. **Testability** — How easily the code can be automatically tested. Determined by dependency injection, side-effect management, and pure function ratio.
4. **Performance** — Time and memory efficiency. Measured via algorithmic complexity (Big O), database query plans, bundle size.

**Priority order**: Correctness > Maintainability > Testability > Performance.

---

## Design Patterns

### Creational (Managing object instantiation)

- **Factory Method** — when object creation logic is complex or needs subclassing.
- **Abstract Factory** — related families of objects that must be consistent (e.g., UI components for dark/light themes).
- **Builder** — objects with >4 parameters, especially if many are optional.
- **Singleton** — use only if strictly necessary across the entire process (logging, config registry). DI containers are better for service layer.
- **Prototype** — object cloning is expensive. Avoid in JS/TS (spread operators, `structuredClone()`).

### Structural (Managing composition)

- **Adapter** — connects two incompatible interfaces. Zero side effects.
- **Decorator** — adds behavior without changing the class. Supports composition (e.g., caching decorator on repository).
- **Facade** — simplifies complex subsystems. Mandatory for legacy code.
- **Proxy** — controls access to another object (lazy loading, logging, access control).

### Behavioral (Managing algorithms and communication)

- **Strategy** — algorithms selectable at runtime. Alternative to if-else chains.
- **Observer / Event Emitter** — 1-to-N notifications. Caution: memory leaks from unsubscribing.
- **Command** — encapsulates request as object. For undo/redo, queues, transaction logging.
- **Template Method** — skeleton algorithm with overridable steps. Fragile base class; use carefully.
- **State** — object changes behavior when internal state changes.

**Golden Rule**: Do not force patterns. If a pattern makes code more complex rather than simpler, it is wrong.

---

## Metrics & Heuristics

| Metric | Threshold | Meaning |
|--------|-----------|---------|
| Cyclomatic Complexity (McCabe) | M <= 10 ideal, M > 20 untestable | M = E - N + 2P (edges, nodes, exit points) |
| Cognitive Complexity | <= 15 | Counts nesting depth, boolean logic, recursion |
| Lines of Code per Function | <= 20-30 | >30 = almost certainly >1 responsibility |
| Depth of Inheritance | <= 3 | >3 = replace with composition |
| Fan-out (dependencies per module) | <= 7-10 | >10 = coupling too high |
| Afferent Coupling (Ca) | Modular | High Ca = critical module, high risk per change |
| Method Parameter Count | <= 3 | >3 = use parameter object or builder |
| Test Assertions per Test | >= 1 per test case | One test case = one behavior |
| Branch Coverage | >= 80% | Every if/else must have a test for both branches |

---

## Testability Heuristics

Pure functions (no side effects) are trivial to test. Clear inputs/outputs, no mocks needed.

| Source of Uncertainty | Testability Strategy |
|---|---|
| I/O (filesystem, network, database) | Inject dependency / gateway abstraction. Test with mocks/in-memory. |
| `Date.now()`, `Math.random()` | Inject as parameter or deferred function. |
| Global state / Singleton | Avoid. If necessary, wrap in mockable wrapper. |
| Hard-coded config | Read from parameters, not from environment in method body. |
| Static methods (third-party) | Wrap in injected interface. Static methods cannot be mocked. |

**Rule of thumb**: If testing a function requires mocking >3 dependencies, it violates SRP.
