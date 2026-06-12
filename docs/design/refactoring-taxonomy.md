# Refactoring Taxonomy

Full reference for refactoring-engineer's domain knowledge. See `agents/refactoring-engineer.md` for process and SOLID in refactoring context.

## Code Smells Taxonomy (Fowler / Martin)

### Bloaters

- **Long Method** — >20 lines suspicious. Accumulation from stacked features. Solution: Extract Method.
- **Large Class** — >20-30 fields/methods. Solution: Extract Class.
- **Primitive Obsession** — data needing its own class (address, money, date range) as strings/numbers. Solution: Replace Primitive with Object.
- **Long Parameter List** — >3-4 parameters. Solution: Introduce Parameter Object, Preserve Whole Object.
- **Data Clump** — fields always appearing together (x, y, z). Solution: Extract Class.

### OO Abusers

- **Switch Statements / If Chain** — type-checking logic when polymorphism could work. Solution: Replace Conditional with Polymorphism.
- **Temporary Field** — fields populated only under certain conditions. Solution: Extract Class.
- **Refused Bequest** — subclasses inheriting unused parent methods. Solution: Replace Inheritance with Delegation.
- **Alternative Classes with Different Interfaces** — same behavior, different APIs. Solution: Extract Interface.

### Change Preventers

- **Divergent Change** — one class changes for different reasons. Single Responsibility violation.
- **Shotgun Surgery** — one change forces edits across many files. Solution: Move Method, Move Field.
- **Parallel Inheritance Hierarchies** — adding to one hierarchy requires adding to another. Solution: replace with delegation.

### Dispensables

- **Comments** — explaining "what" rather than "why". Solution: Extract Method.
- **Duplicate Code** — identical/similar code in multiple places. Solution: Extract Method, Pull Up Method.
- **Lazy Class** — too little responsibility. Solution: Inline Class, Collapse Hierarchy.
- **Data Class** — only getters/setters, no behavior. Solution: Move Method.
- **Dead Code** — never called. Delete it. Version control keeps it.
- **Speculative Generality** — "maybe later" code. Solution: Inline Class, Collapse Hierarchy.

### Couplers

- **Feature Envy** — method accesses another class's data more than its own. Solution: Move Method.
- **Inappropriate Intimacy** — two classes too familiar with internals. Solution: Move Method, Change Bidirectional to Unidirectional.
- **Message Chain** — A.getB().getC().getD().doSomething(). Solution: Hide Delegate.
- **Middle Man** — class merely delegates, adds no value. Solution: Remove Middle Man.

---

## Refactoring Techniques Catalog (Fowler)

### Extraction & Movement

- **Extract Method**: logically grouped code block to separate method. If you need a comment, extract it.
- **Extract Class**: tightly related fields/methods within a class unrelated to the rest.
- **Extract Interface**: multiple clients using same subset of class methods.
- **Move Method / Move Field**: if a method/field uses another class more than its own.

### Conditional Simplification

- **Decompose Conditional**: long if/else to methods with descriptive names.
- **Replace Nested Conditional with Guard Clauses**: early exits over nested ifs.
- **Replace Conditional with Polymorphism**: switch on type to class hierarchy.
- **Introduce Assertion**: explicit assumptions at specific code points.

### Call Simplification

- **Replace Temp with Query**: calculated variable to reusable method.
- **Introduce Parameter Object**: parameters always traveling together to new object.
- **Preserve Whole Object**: pass entire object instead of multiple fields.
- **Remove Middle Man**: call actual class directly if delegation adds nothing.
- **Replace Inheritance with Delegation**: composition over inheritance.

### Data Management

- **Replace Magic Literal with Constant**: status === 3 to status === ORDER_SHIPPED.
- **Replace Primitive with Object**: strings/numbers with business rules to value objects.

---

## Quality Metrics

| Metric | Formula | Threshold |
|--------|---------|-----------|
| LCOM (Lack of Cohesion of Methods) | method pairs not sharing fields - pairs sharing fields | >0.8 = split, <0.3 = cohesive |
| Afferent Coupling (Ca) | entities depending on module | >20 high |
| Efferent Coupling (Ce) | entities module depends on | >10 requires restructuring |
| Cyclomatic Complexity (McCabe) | M = E - N + 2P | <10 simple, 10-20 moderate, >50 untestable |
| Function Length | Lines | >20 suspicious, >50 refactor, >100 problematic |

---

## Architectural Patterns for Refactoring

### Strangler Fig Pattern
Gradual legacy replacement without big-bang rewrite. Facade routes traffic to old/new code. Steps: (1) identify sliceable module, (2) parallel implementation, (3) route traffic, (4) delete old code.

### Test-Driven Refactoring
Before touching code: ensure test coverage. If none, write characterization tests (capture actual I/O). Refactor in 1-3 change steps. Tests green after each step. **No features during refactoring.**

### Feature Toggle
Old and new behavior live side-by-side with boolean flags. Instant rollback, gradual rollout. Clean up stable toggles in next cycle.

### Inversion of Control / Dependency Injection
Dependencies received via constructor, not instantiated with `new()`. Benefits: testability, flexibility, decoupling.

---

## Refactoring Anti-patterns

- **Big Bang Refactor** — changing everything at once. High risk. Use Strangler Fig instead.
- **Refactor-on-the-fly** — altering structure while adding features. Hard to review/rollback.
- **Scope Creep** — "might as well look at that..." end up refactoring everything.
- **Golden Hammer** — forcing the same pattern for all problems.
- **Over-Engineering** — abstractions "just in case" never used (Speculative Generality).
