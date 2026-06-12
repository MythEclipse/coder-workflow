# Workflow Philosophy

1. **Tasks tracking** — Use `TaskCreate` to organize work, but initial codebase exploration using read-only tools is permitted before task creation.
2. **Skills before guesses** — always route to appropriate skill.
3. **Hooks enforce tool rules** — MANDATORY: You MUST use Graph MCP (codegraph) to scan, search, and view the codebase structure. Do NOT use raw bash tools like find/grep for exploration.
4. **Track every discovered bug** — Track bugs as low-priority tasks and fix them at the end of the session, preventing feature starvation.
5. **No Excuses for Pre-existing Issues** — NEVER ignore warnings, errors, or diagnostic messages by claiming they are "pre-existing" or "not from my changes". If you see an error or warning, you MUST fix the underlying logic and solve the problem completely.
