# Modular MVC + Service + Repository Layer Contract

Work with any language, any framework, any ORM, and any validation library. The
principles below are universal; apply them in the idioms of the detected stack.

## One-way dependency direction

```
Route → Controller → Service → Repository → Database/Client
```

`modules → shared` is allowed. `shared → modules` is not allowed.

## Layer responsibilities (universal)

### Route

- Declare endpoints: HTTP method + path → handler, or framework-equivalent wiring.
- Attach middleware, guards, validators.
- **Must NOT**: contain business logic, database access, or inline validation.

### Controller

- Parse incoming data: body, params, query, headers, cookies, form-data,
  framework context, or framework request object.
- Call the appropriate service method with extracted values.
- Format and return the response using the framework's response helpers.
- **Must NOT**: contain database queries, ORM calls, hashing, pricing logic,
  or any business decision. No raw SQL, no direct model access.

### Service

- Contain all application / business decisions: uniqueness checks, password
  hashing, totals/pricing calculation, stock validation, domain state
  transitions, coordination across repositories.
- Accept plain values/structs/objects/dataclasses — never the framework
  request, response, or HTTP context.
- Call repositories for persistence; never call the ORM / database client
  directly.
- Call other services when cross-module coordination is needed.
- **Must NOT**: touch framework request/response objects, call ORM or SQL
  directly, or import HTTP/network types.

### Repository

- Contain all database / persistence access: find, create, update, delete,
  pagination, filtering, joins, aggregations, and transactions.
- One method per distinct persistence operation.
- Return typed/structured data (entities, models, dataclasses, structs) —
  never framework response types.
- **Must NOT**: contain business rules, validation beyond data integrity,
  or import framework request/response types.

### Schema

- Define input shape, types, and validation rules at the request boundary.
- Use the project's validation library (Zod, Joi, class-validator, Pydantic,
  Marshmallow, go-playground/validator, Jakarta Bean Validation, etc.).
- Connect via middleware, decorator, dependency injection, or framework-native
  validation hooks — whichever is idiomatic for the stack.
- **Must NOT**: be duplicated across controllers or services.

## Common violations (language-agnostic)

| Violation | Concrete example |
|-----------|-----------------|
| Route contains logic | Route handler that queries DB or hashes passwords |
| Controller talks to DB | Controller importing ORM model and calling `.findOne()`, `.filter()`, `SELECT ...` |
| Controller decides | Controller hashing passwords, calculating prices, deciding domain state |
| Service touches framework | Service accepting `req`, `res`, `HttpRequest`, `RequestContext`, `Response` |
| Service talks to DB | Service calling ORM/model directly instead of through repository |
| Repository leaks framework | Repository importing HTTP response types or framework context |
| Repository decides | Repository throwing `InsufficientFundsError` — that's a service decision |
| Schema duplicated | Same validation rules written in both controller and service |
| Cross-module leak | Module A importing Module B's repository or controller directly |

## Safe extraction order

1. Extract repository methods from existing database calls — don't change
   query semantics.
2. Extract service methods around existing business logic — don't change
   branch conditions.
3. Thin controllers to request parsing and response formatting.
4. Move validation into schema files and connect them at the boundary.
5. Reorganize files by feature once imports are stable.
6. Run focused verification after each module.
