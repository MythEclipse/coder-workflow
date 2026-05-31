# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `test/` directory with skill-trigger validation tests (20 tests)

### Changed
- Merged `codegraph-orchestrator` into `coder-orchestrator` — single orchestrator with unified workflow + codegraph search routing

### Removed
- `skills/batch-codegraph/` — duplicate removed; canonical version is in codegraph-mapper plugin

### Changed
- `skills/refraktor/` designated as canonical Modular MVC refactor skill (multi-language, EnterPlanMode)
- `coder-orchestrator` routing matrix updated to reference `batch-codegraph` from codegraph-mapper

## [0.2.0] — 2026-05-24

### Added
- `coder-orchestrator` skill — dual-orchestrator model (workflow + codegraph)
- `coder` skill — disciplined implementation workflow with task tracking
- `auditor` skill — read-only architecture and layer violation audit
- `refraktor` skill — multi-language Modular MVC + Service + Repository refactor with mandatory planning
- `deploy-docker` skill — Docker, GHCR, VPS, Traefik deployment workflow
- 3 agents: workflow-planner, architecture-auditor, code-implementer
- 3 commands: coder-workflow, audit, plan
- `hooks/hooks.json` — SessionStart, PostToolUse, Stop hooks
- Bug Fix Phase mandate — all discovered bugs must be tracked and fixed
- Subagent-Driven Development pattern with two-stage review
- Explore agent codegraph-first rule — all exploration must prioritize codegraph MCP tools

## [0.1.0] — 2026-05-19

### Added
- Initial release
- Basic orchestrator skill for coding workflow routing
- Workflow planner agent for task decomposition
- Architecture auditor agent for read-only review
- Code implementer agent for scoped implementation
