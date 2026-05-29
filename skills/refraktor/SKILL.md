---
name: refraktor
description: Refactor codebases toward Modular MVC + Service + Repository architecture. Language-agnostic — works with TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Kotlin, Swift, or any other stack. Trigger when the user asks to refactor to Modular MVC, separate Controller-Service-Repository layers, reorganize by feature/module, fix fat controllers, add schema validation, or migrate from flat layout.
version: 0.2.0
argument-hint: "[scope-optional]"
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(*)
---

Transform any codebase toward **Modular MVC + Service + Repository** architecture without changing existing functional behavior. Organize by feature/module, not by global technical layer. This skill adapts to any language, framework, ORM, or validation library.

## Required planning

For non-trivial refactors, enter Claude Code plan mode before editing. Use the plan to identify scope, affected files, migration order, validation commands, and rollback-safe checkpoints. Do not start moving files or rewriting imports until the user approves the approach.

Use focused implementation batches. Finish one module or one layer movement, verify it, then continue.

## Phase 0: Stack detection

Before any refactor, auto-detect the project stack and adapt all conventions accordingly:

1. **Language**: identify from source files — TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Kotlin, Swift, etc.
2. **Framework**: Express, NestJS, FastAPI, Django, Flask, Gin, Echo, Actix, Spring Boot, Laravel, Rails, etc.
3. **ORM / database layer**: Prisma, TypeORM, SQLAlchemy, GORM, Diesel, Hibernate, Eloquent, ActiveRecord, raw SQL client, etc.
4. **Validation library**: Zod, Joi, class-validator, Pydantic, Marshmallow, go-playground/validator, Bean Validation, etc.
5. **Package manager / build tool**: npm, pnpm, yarn, pip, poetry, go mod, cargo, maven, gradle, composer, bundler, etc.
6. **Test runner**: jest, vitest, pytest, go test, cargo test, JUnit, phpunit, rspec, etc.
7. **Linter/formatter**: biome, eslint, ruff, black, gofmt, clippy, checkstyle, php-cs-fixer, rubocop, etc.
8. **Type checker** (if applicable): tsc, mypy, pyright, go build, cargo check, javac, etc.
9. **File extensions**: detect from the project convention and use the same extensions for new files.

Map these to concrete commands per phase. When a tool category doesn't exist in the stack, skip it and note the gap.

## Target architecture contract

Route requests through this one-way layer order:

```text
Route → Controller → Service → Repository → Schema
```

Apply these responsibilities regardless of language/framework:

- **Route**: declare endpoint method/path and connect middleware/controller. Keep business logic out.
- **Controller**: parse incoming request data (body, params, query, headers, cookies, form data, context); call service; return response. Keep database calls, hashing, and business decisions out.
- **Service**: hold application decisions and orchestration. Check uniqueness, hash passwords, calculate totals, validate stock, and coordinate repositories. Never touch framework request/response objects or ORM models directly.
- **Repository**: contain database access only: find, create, update, delete, pagination, filtering, joins, and transactions. Avoid business branching and framework response types.
- **Schema**: validate input at request boundaries using the project's validation library. Connect via middleware, decorators, dependency injection, or framework-native validation hooks.

Prefer feature modules. Adapt directory layout and file extensions to the detected stack:

```text
src/
├── modules/
│   └── user/
│       ├── user.route.<ext>        # endpoint declarations
│       ├── user.controller.<ext>   # request → service → response
│       ├── user.service.<ext>      # business logic + orchestration
│       ├── user.repository.<ext>   # database access
│       └── user.schema.<ext>       # input validation
├── shared/
│   ├── database/                   # ORM setup / DB connection
│   ├── config/                     # env loading / app configuration
│   ├── middleware/                  # auth guards, rate limiters, error handlers
│   ├── logger/                     # logging utilities
│   └── utils/                      # pure helper functions
└── types/                          # shared type definitions (if applicable)
```

For languages that don't use files per class (e.g. Go package convention), group by package and adjust filenames accordingly. For framework-specific module conventions (NestJS modules, Django apps, Laravel modules), adapt the folder structure while preserving layer separation.

## Workflow

### Fase 1: Recon & detection

Before touching any code:

1. **Check git status** — the working tree should be clean or the user must confirm uncommitted changes.
2. **Run the test suite** — must be all-green before starting. Detect the correct test command for the stack.
3. **Run type checker** (if applicable) — must be clean. Use the detected typecheck command.
4. **Ensure graph data is fresh** — if `.codegraph/graph.db` exists, use `analyze-codegraph` for architecture overview and hotspots. If stale or missing, run `scan-codegraph` or note the gap.
5. **If any gate fails**, stop and report the blocker. Do not proceed until resolved.

Identify smells with `file:line` evidence:

| Smell | Signature | Violating layer |
|-------|-----------|-----------------|
| Fat controller | Controller contains ORM queries, SQL strings, business decisions, hashing, or pricing logic | Controller |
| Missing repository | Service calls ORM/model/database directly instead of through a repository | Service |
| Schema-less boundary | Validation is inline in route handler, controller, or service; no dedicated schema file | Schema |
| Layer leakage | Repository imports framework request/response types or HTTP context | Repository |
| Cross-module leak | Module A imports Module B's repository or controller directly | Cross-module |
| Flat layout | All controllers/services/repositories in global flat folders obscuring feature ownership | Structure |

Record git-active files (`git status --short`) and prioritize them as the initial scope.

Output: **Recon Report** — a table of violations per file with severity and proposed scope. User must approve scope before Phase 2.

### Fase 2: Stabilize shared infrastructure

Before touching any module, reorganize the shared layer:

- Move database connection / ORM setup → `shared/database/`
- Move env loading / configuration → `shared/config/`
- Move custom error classes + global error handler → `shared/errors/`
- Move generic middleware (auth guard, rate limiter, logger) → `shared/middleware/`
- Move pure utility functions used by multiple modules → `shared/utils/`

**Verification gate:**
- `shared/` must never import from `modules/`.
- Typecheck clean after each file move (if applicable).
- Lint clean after each file move.
- Tests passing after each file move.

If any import violation or error appears, stop and fix before continuing.

### Fase 3: Migrate module-by-module

For each feature module (user, auth, product, order, payment, etc.), follow this extraction order:

#### Route file
- Only endpoint declarations (HTTP method + path → controller method).
- No logic beyond middleware selection/wiring.
- Gate: typecheck + lint clean.

#### Controller file
- Only: parse request → call service → format response.
- No database queries, hashing, or business calculations.
- Gate: typecheck + lint clean.

#### Service file
- Core application logic: business decisions, orchestration, coordination.
- Never touches framework request/response objects.
- Never calls ORM/database directly — always through repository.
- Gate: typecheck + lint clean.

#### Repository file
- All database access lives here: find, create, update, delete, pagination, filtering, joins, transactions.
- One method per distinct database operation.
- Returns typed/structured data, never framework response types.
- No business logic or conditional branching beyond persistence concerns.
- Gate: typecheck + lint clean.

#### Schema file
- Input validation at the request boundary.
- Wired as middleware, decorator, or first call in controller — per framework convention.
- Gate: typecheck + lint clean.

#### Cross-module rule
- Module A may only import from Module B's **service**, never its controller or repository.
- If cross-module circular dependency emerges, extract shared logic to `shared/utils/` or create a domain service.
- Gate: `analyze-codegraph` must detect no cross-module repository/controller imports.

### Fase 4: Verify after each batch

After completing each module, run full verification:

1. **Typecheck** (if applicable): detected typecheck command — must be clean.
2. **Lint**: detected linter command — must be clean.
3. **Affected module tests**: run the subset most relevant to the changed module.
4. **Full test suite**: detected test command — must be all-green.
5. **Impact check**: `analyze-codegraph` to verify no unexpected broken callers.

If any new failure appears → stop, fix it, then continue to the next module.

### Fase 5: Output & summary

After the full scope is complete, produce:

1. **Architecture map before** — files with layer violations detected.
2. **Migration manifest** — `old path → new path` table for every moved file.
3. **Violation summary** — what was fixed per violation type.
4. **Verification results** — typecheck, lint, test outcomes post-refactor.
5. **Residual items** — areas intentionally deferred with reasons.
6. **Next refactor targets** — high-priority candidates for the next session.

## Safety rules (non-negotiable)

- **Preserve behavior; refactor structure, not logic.**
- **Do not use `git reset --hard`, `git checkout --`, or mass delete without explicit user approval.**
- **Do not add new features during refactor** unless the user requests them.
- **Do not change public API contracts without confirmation.**
- **Do not use suppression flags** (`@ts-ignore`, `eslint-disable`, `#[allow(...)]`, `# type: ignore`, etc.) to hide errors. Fix the root cause.
- **Treat every typecheck/lint warning as an error** — fix before moving on.
- **Prefer small batches with verification over sweeping rewrites.**
- **If full validation is too expensive**, run the most relevant subset and report the limitation.

## Anti-patterns to eliminate (language-agnostic)

| Anti-pattern | Example |
|---|---|
| Controller with direct ORM access | Controller calling `db.user.findFirst()`, `User.objects.filter()`, `SELECT * FROM users` |
| Service touching request/response | Service accepting `req`, `res`, `HttpRequest`, `Response`, `RequestContext` |
| Business logic in repository | Repository with `if balance < amount → throw InsufficientFundsError` (should be in service) |
| Raw SQL in service or controller | SQL strings outside of repository layer |
| Inline validation in route handler | `if (!body.email.includes('@'))` inside a route/controller |
| Cross-module repository import | `order.service` importing `user.repository` directly instead of `user.service` |
| Shared importing from modules | `shared/database` importing anything from `modules/user` |

## Additional resources

- `references/layer-contract.md` — detailed layer responsibilities and common violations.
