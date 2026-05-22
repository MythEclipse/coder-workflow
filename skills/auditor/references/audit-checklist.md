# Architecture Audit Checklist

## Layers

- Routes only declare endpoints and middleware.
- Controllers parse requests and format responses.
- Services hold application decisions and orchestration.
- Repositories own persistence calls.
- Schemas validate request boundaries.
- Shared infrastructure has no dependency on feature modules.

## Evidence to collect

- `file:line` for each violation.
- Import chains showing layer direction.
- Callers/callees for risky functions.
- Test coverage or missing verification commands.
- Recent modified files that increase merge or regression risk.

## Report

Group findings by severity and include the smallest safe next step for each finding.
