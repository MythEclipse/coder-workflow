---
name: check-dummy-code
description: Scans the codebase for leftover TODOs, FIXMEs, and dummy placeholders using a fresh subagent to save tokens.
---

# Check Dummy Code Skill

This skill dispatches the `todo-checker` subagent to scan the codebase for leftover `TODO`s, `FIXME`s, or temporary dummy code.

## Execution Steps

1. Identify the files that were recently modified (or decide to scan the entire codebase if appropriate).
2. Use the `Agent` tool (or `invoke_subagent` if available) to spawn the `todo-checker` agent. Provide it with the list of files to check, or instruct it to scan the whole project.
3. Wait for the subagent's report.
4. Present the `Dummy Code & TODO Report` to the user.
5. If requested, fix any identified issues (by removing dummy code or resolving TODOs).

**Note:** Always use the subagent to perform the scan. Do not run the grep/glob searches yourself to preserve the main context window tokens.


---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**
