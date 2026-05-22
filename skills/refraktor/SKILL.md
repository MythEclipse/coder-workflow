---
name: refraktor
description: This skill should be used when the user asks to "refractor to Modular MVC", "refactor controller service repository", "pisahkan controller service repository", "rapikan arsitektur modular", "pindahkan logic dari controller", or mentions fat controllers, repositories, schemas, validation layers, or Modular MVC + Service + Repository architecture.
version: 0.1.0
argument-hint: "[scope-optional]"
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(npm:*), Bash(node:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*)
---

Transform codebases toward **Modular MVC + Service + Repository** architecture without changing existing functional behavior. Organize code by feature/module, not by global technical layer.

## Required planning

For any non-trivial refactor, enter Claude Code plan mode before editing. Use the plan to identify scope, affected files, migration order, validation commands, and rollback-safe checkpoints. Do not start moving files or rewriting imports until the user approves the approach.

Use focused implementation batches. Finish one module or one layer movement, verify it, then continue.

## Target architecture contract

Route requests through this one-way layer order:

```text
Route → Controller → Service → Repository → Schema
```

Apply these responsibilities:

- **Route**: declare endpoint method/path and connect middleware/controller. Keep business logic out.
- **Controller**: read `req.body`, `req.params`, and `req.query`; call service; return response. Keep database calls, hashing, and business decisions out.
- **Service**: hold application decisions and orchestration. Check uniqueness, hash passwords, calculate totals, validate stock, and coordinate repositories. Never touch `req`/`res` or ORM models directly.
- **Repository**: contain database access only: find, create, update, delete, pagination, filtering, joins, and transactions. Avoid business branching and HTTP types.
- **Schema**: validate input at request boundaries using the project’s validation library such as Zod, Joi, class-validator, Pydantic, or framework-native schemas.

Prefer feature modules:

```text
src/
├── modules/
│   └── user/
│       ├── user.route.ts
│       ├── user.controller.ts
│       ├── user.service.ts
│       ├── user.repository.ts
│       └── user.schema.ts
├── shared/
│   ├── database/
│   ├── config/
│   ├── middlewares/
│   ├── logger/
│   └── utils/
└── types/
```

Adapt filenames and extensions to the current stack. Preserve public API behavior unless the user explicitly approves a contract change.

## Workflow

1. **Recon first**
   - Check current git status and identify user changes before editing.
   - Inspect routes, controllers, services, repositories, schemas, shared infrastructure, tests, and package scripts.
   - Prefer graph/code intelligence tools when available for cross-file dependency and impact questions.
   - Record violations with `file:line` evidence.

2. **Detect layer violations**
   - Fat controller: controller imports ORM/model or performs business decisions.
   - Missing repository: service calls ORM/model directly.
   - Schema-less boundary: validation lives inline in route/controller/service.
   - Layer leakage: repository imports HTTP request/response types.
   - Cross-module leak: module imports another module’s repository/controller directly.
   - Flat layout: global `controllers/`, `services/`, or `repositories/` folders obscure feature ownership.

3. **Stabilize shared infrastructure**
   - Move generic database/ORM setup to `shared/database/` or the project equivalent.
   - Move env/config loading to `shared/config/`.
   - Move common middleware, logging, errors, and pure utilities to `shared/`.
   - Verify `shared/` never imports from `modules/`.

4. **Migrate module-by-module**
   - Keep route files declarative.
   - Move request/response handling into controllers only.
   - Move decisions and orchestration into services.
   - Move database access into repositories.
   - Move boundary validation into schema files and connect it via middleware or the framework’s validation path.
   - Allow Module A to call Module B’s service, not Module B’s repository or controller.

5. **Verify after each batch**
   - Run the smallest relevant typecheck, lint, and test command available.
   - Expand to the full suite when the scope is stable.
   - Treat new typecheck/lint warnings as failures to fix, not suppress.
   - If validation is expensive or unavailable, report the exact limitation.

## Output requirements

After work or audit, report:

- Architecture map before: files and layer violations found.
- Migration manifest: old path → new path for moved files.
- Violation summary: what changed per violation type.
- Verification results: typecheck, lint, and test outcomes.
- Residual items: deferred risks and why.
- Next refactor targets: highest-priority follow-up areas.

## Safety rules

- Preserve behavior; refactor structure, not features.
- Do not use destructive git operations without explicit user approval.
- Do not add features during refactor unless requested.
- Do not change public API contracts without confirmation.
- Do not hide errors with suppression flags such as `@ts-ignore`, `eslint-disable`, or equivalent.
- Prefer small batches with verification over sweeping rewrites.

## Additional resources

- `references/layer-contract.md` describes layer responsibilities and common violations in more detail.
