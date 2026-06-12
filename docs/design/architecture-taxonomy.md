# Architecture Taxonomy

Full reference for architecture-auditor's domain knowledge. See `agents/architecture-auditor.md` for Layer Violation Taxonomy, Common Problem Patterns, and Related Laws.

## Coupling Metrics

### Instability (I) = Ce / (Ce + Ca)
- Ce = efferent coupling (dependencies this module needs from outside)
- Ca = afferent coupling (outside modules that depend on this module)
- I = 1.0 means the module is unstable (many outgoing deps, nothing depends on it)
- I = 0.0 means the module is highly stable (no outgoing deps, many depend on it)
- Ideal: concrete modules (impls) have high I, abstract modules (interfaces) have low I

### Abstractness (A) = Na / Nc
- Na = number of abstract types (interface, abstract class)
- Nc = total number of types
- A = 1.0 = completely abstract (pure interface module)
- A = 0.0 = completely concrete (pure implementation module)

### Distance from Main Sequence (D) = |A + I - 1|
- Measures how far a module is from the ideal zone between abstraction and stability
- D = 0 means balanced (abstraction proportional to stability)
- D > 0.7 means problematic: "zone of uselessness" (too much abstraction) or "zone of pain" (too fragile)
- During audit: D > 0.5 deserves attention

**Usage**: For each suspicious module, calculate I and D. Modules with D > 0.7 and high fan-in are highest refactoring priorities.

---

## Graph Theory for Codebases

Code is a directed graph: nodes = files/modules, edges = imports/dependencies.

- **Fan-in** = edges entering a node. High fan-in = hotspot — changes here carry high risk.
- **Fan-out** = edges leaving a node. High fan-out = fragility — any dependency change could break this file.
- **Cycle (SCC)** — File A imports B, B imports C, C imports A. Violates DAG principle.
  - Causal analysis mandatory: (a) circular type dependency fixable by extract to third file, (b) bidirectional event needing event bus, (c) lazy initialization refactor.
  - Small cycles (2-3 files) sometimes tolerable. Large cycles (5+ files) need dismantling.

---

## Architectural Styles & Characteristics

| Style | Dependency Pattern | Violation Indicator |
|---|---|---|
| **Layered (strict)** | Can only step down one layer: Controller -> Service -> Repository -> DB | Controller calls Repository directly |
| **Hexagonal (Ports & Adapters)** | Domain core knows nothing about infrastructure. Ports in domain, Adapters in infra | Domain core imports database driver, HTTP framework, or external library |
| **Feature-Sliced Design (FSD)** | Every feature has ui/model/api/lib/. Cross-feature only via shared/ | `features/order` imports from `features/user/model` |
| **Vertical Slice** | All code for one use-case in one folder | Forcing code into traditional layers |
| **Modular MVC** | Controller only for routing, Service for business logic, Repository for data access | Controller contains SQL or business logic (Fat Controller) |
| **Clean Architecture** | Outer rings (framework/DB) depend on inner rings (use-case/entity) | Outer ring forces inner ring to depend on it |
