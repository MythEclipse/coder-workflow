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


---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**
