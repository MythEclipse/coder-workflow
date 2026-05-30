# Analyze CodeGraph — Reference Guide

## MCP Tools

| Tool | Description |
|------|-------------|
| `analyze_impact` | Upstream/downstream impact analysis for a target |
| `find_cycles` | Detect circular dependencies |
| `find_orphans` | Identify unused files/symbols |
| `summarize_architecture` | Architecture overview: entry points, modules, hotspots |
| `summarize_graph` | Bounded graph summary with node/edge counts |
| `analyze_quality` | Codebase graph quality: unresolved imports, stale data, duplicates |
| `quality_gate` | Evaluate quality gate against a threshold |

## Analysis Type Selection

| Question | Analysis |
|----------|----------|
| What breaks if I change this file? | `analyze_impact` |
| Are there circular dependencies? | `find_cycles` |
| What files are unused/dead code? | `find_orphans` |
| What's the overall architecture? | `summarize_architecture` |
| How big/complex is this graph? | `summarize_graph` |
| Are there unresolved imports or stale data? | `analyze_quality` |
| Does the codebase meet quality standards? | `quality_gate` |

## Impact Analysis Details

### Risk Levels
| Level | Criteria | Action |
|-------|----------|--------|
| **High** | Changes to high fan-in nodes (many dependents) | Full regression test required |
| **Medium** | Changes to moderate fan-in nodes | Run affected module tests |
| **Low** | Leaf nodes with no dependents | Minimal testing needed |

### Direct vs Transitive
- **Direct**: immediate upstream/downstream neighbors
- **Transitive**: all nodes reachable through dependency chains
- Report both; transitive scope can be orders of magnitude larger

## Cycle Detection

- Uses Tarjan's algorithm for strongly connected components
- Reports shortest cycle paths first
- Common causes:
  - Mutual imports between modules
  - Shared utilities importing from feature modules
  - Event emitter patterns creating implicit cycles

## Orphan Detection

Excluded by default (not true orphans):
- Entry points (main, index, app)
- Configuration files
- Build scripts
- Documentation
- Test files
- Generated files

## Architecture Summary

Provides:
- **Entry points**: files with no inbound edges but many outbound
- **Core modules**: high degree, high centrality nodes
- **Shared dependencies**: fan-in hotspots used by many modules
- **External boundaries**: adapter layers connecting to external systems
- **Hotspots**: high-degree nodes with mixed edge types

## Layer Violation Detection

When analyzing for refactor readiness, look for:

| Violation | Detection Pattern |
|-----------|------------------|
| Fat controller | Controller node calls repository/ORM nodes directly |
| Missing repository | Service node calls ORM/database nodes |
| Schema-less validation | No schema nodes at route boundary |
| Layer leakage | Repository node depends on HTTP framework nodes |
| Cross-module coupling | Module A imports Module B's repository/controller |
| Flat layout | All files in global directories, no feature grouping |

## Quality Gate Thresholds

| Threshold | When to Use |
|-----------|------------|
| `high` | Production release, major refactor |
| `medium` | Feature branch, routine review |
| `low` | Exploration, initial scan |
