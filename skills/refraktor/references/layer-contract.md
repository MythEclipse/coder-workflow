# Modular MVC + Service + Repository Layer Contract

## Allowed dependency direction

`route -> controller -> service -> repository -> database/client`

`modules -> shared` is allowed. `shared -> modules` is not allowed.

## Common violations

- Route contains business logic or inline validation beyond middleware wiring.
- Controller imports ORM/model/database client directly.
- Controller hashes passwords, calculates pricing, or decides domain state.
- Service receives `req`, `res`, framework context, or HTTP response helpers.
- Service calls ORM/model directly when repository extraction is required.
- Repository imports HTTP types or returns response objects.
- Repository makes business decisions instead of persistence decisions.
- Schema validation is duplicated across controllers/services.
- Module imports another module's repository or controller directly.

## Safe extraction order

1. Extract repository methods from existing database calls without changing query semantics.
2. Extract service methods around existing business logic without changing branch conditions.
3. Thin controllers to request parsing and response formatting.
4. Move validation into schema files and connect them at the boundary.
5. Reorganize files by feature once imports are stable.
6. Run focused verification after each module.
