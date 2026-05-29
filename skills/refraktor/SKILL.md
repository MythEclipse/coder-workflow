---
name: refraktor
description: Refactor codebases toward Modular MVC + Service + Repository architecture. Language-agnostic — works with TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Kotlin, Swift, or any other stack. Trigger when the user asks to refactor to Modular MVC, separate Controller-Service-Repository layers, reorganize by feature/module, fix fat controllers, add schema validation, or migrate from flat layout.
version: 0.3.0
argument-hint: "[scope-optional]"
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(*)
---

Transform any codebase toward **Modular MVC + Service + Repository** architecture without changing existing functional behavior. Organize by feature/module, not by global technical layer. This skill adapts to any language, framework, ORM, or validation library.

## HARD GATE: Planning is mandatory

**Every refactor — no matter how small — must start with a written plan approved by the user.** There are no exceptions. Structural refactors are high-risk; moving files and rewriting imports without a plan causes breakage.

The mandatory planning flow:

1. **Enter plan mode** (`EnterPlanMode`) before any file edit, file move, or import rewrite.
2. Inside plan mode, execute Phase 0 (stack detection) and Phase 1 (recon & violation detection).
3. Write the plan to the plan file. The plan must include:
   - Detected stack summary (language, framework, ORM, validation lib, test runner, linter, type checker, package manager).
   - Architecture map before: current file topology with layer assignments and violation locations (`file:line`).
   - Migration manifest: every `old path → new path` mapping proposed.
   - Module migration order: which modules get refactored first, second, third, with rationale.
   - Risk register: circular dependency risks, cross-module coupling hot spots, files with high fan-in.
   - Verification commands: exact commands to run for typecheck, lint, and tests per batch.
   - Batch plan: which files move in each batch, and verification gates between batches.
4. **Present the plan to the user and wait for explicit approval** (`ExitPlanMode`).
5. Only after approval, start editing files batch-by-batch with verification after each batch.

**Never skip planning.** Even if the user says "just do it quickly" or "this is simple" — plan first. A five-minute plan prevents hour-long rollbacks.

## Phase 0: Stack detection

Detect the project stack automatically before any analysis. Adapt all conventions, file extensions, and commands to the detected stack:

1. **Language**: identify from source files — TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Kotlin, Swift, etc.
2. **Framework**: Express, NestJS, FastAPI, Django, Flask, Gin, Echo, Actix, Spring Boot, Laravel, Rails, etc.
3. **ORM / database layer**: Prisma, TypeORM, SQLAlchemy, GORM, Diesel, Hibernate, Eloquent, ActiveRecord, raw SQL client, etc.
4. **Validation library**: Zod, Joi, class-validator, Pydantic, Marshmallow, go-playground/validator, Bean Validation, etc.
5. **Package manager / build tool**: npm, pnpm, yarn, pip, poetry, go mod, cargo, maven, gradle, composer, bundler, etc.
6. **Test runner**: jest, vitest, pytest, go test, cargo test, JUnit, phpunit, rspec, etc.
7. **Linter/formatter**: biome, eslint, ruff, black, gofmt, clippy, checkstyle, php-cs-fixer, rubocop, etc.
8. **Type checker** (if applicable): tsc, mypy, pyright, go build, cargo check, javac, etc.
9. **File extensions**: detect from project convention; use the same extensions for all new files.

Map each category to a concrete command. When a category doesn't exist in the stack, skip it and note the gap in the plan.

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

### Fase 1: Recon & detection (inside plan mode)

Before touching any code, and before exiting plan mode:

1. **Check git status** — the working tree should be clean or the user must confirm uncommitted changes.
2. **Run the full test suite** — must be all-green before starting. Use the detected test command.
3. **Run type checker** (if applicable) — must be clean. Use the detected typecheck command.
4. **Run linter** — must be clean. Use the detected lint command.
5. **Ensure graph data is fresh** — if `.codegraph/graph.db` exists, use `analyze-codegraph` for architecture overview, dependency mapping, and hotspots. If stale or missing, run `scan-codegraph`.
6. **If any gate fails**, stop and report the blocker in the plan. Do not proceed until user resolves.

Identify every violation with `file:line` evidence:

| Smell | Signature | Violating layer |
|-------|-----------|-----------------|
| Fat controller | Controller contains ORM queries, SQL strings, business decisions, hashing, or pricing logic | Controller |
| Missing repository | Service calls ORM/model/database directly instead of through a repository | Service |
| Schema-less boundary | Validation is inline in route handler, controller, or service; no dedicated schema file | Schema |
| Layer leakage | Repository imports framework request/response types or HTTP context | Repository |
| Cross-module leak | Module A imports Module B's repository or controller directly | Cross-module |
| Flat layout | All controllers/services/repositories in global flat folders obscuring feature ownership | Structure |

Record git-active files (`git status --short`) and prioritize them as the initial scope.

**Plan must include all seven items** (stack summary, architecture map before, migration manifest, module order, risk register, verification commands, batch plan). User must approve the plan before any file is edited.

### Fase 2: Stabilize shared infrastructure

Before touching any module, reorganize the shared layer:

- Move database connection / ORM setup → `shared/database/`
- Move env loading / configuration → `shared/config/`
- Move custom error classes + global error handler → `shared/errors/`
- Move generic middleware (auth guard, rate limiter, logger) → `shared/middleware/`
- Move pure utility functions used by multiple modules → `shared/utils/`

**Verification gate after each file move:**
- `shared/` must never import from `modules/`.
- Typecheck clean (if applicable).
- Lint clean.
- Tests passing.

If any import violation or error appears, stop and fix before continuing.

### Fase 3: Migrate module-by-module

For each feature module (user, auth, product, order, payment, etc.), follow the safe extraction order:

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

**If any new failure appears → stop, fix it, then continue to the next module. Never proceed with failing gates.**

### Fase 5: Output & summary

After the full scope is complete, produce:

1. **Architecture map before** — files with layer violations detected (from the plan).
2. **Migration manifest** — `old path → new path` table for every file moved (actual, compared to plan).
3. **Violation summary** — what was fixed per violation type.
4. **Verification results** — typecheck, lint, test outcomes post-refactor.
5. **Residual items** — areas intentionally deferred with reasons.
6. **Next refactor targets** — high-priority candidates for the next session.

## Safety rules (non-negotiable)

- **Plan first. Never edit without an approved plan.**
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
