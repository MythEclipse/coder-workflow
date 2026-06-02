# Deploy Guide Reference

Canonical guide: `docs/docker-ghcr-vps-traefik-deploy.md` at the plugin root.

When this skill triggers inside an installed plugin, inspect the plugin documentation if available. Otherwise, use the checklist embedded in `SKILL.md` and ask the user for the concrete placeholders:

- app name
- service name
- container name
- image
- domain
- deploy directory
- Traefik network
- internal port
- Traefik entrypoint
- Traefik cert resolver

Never guess production secrets or VPS paths.


---

# ⚠️ OVERPOWERED ANTI-LAZY DIRECTIVE ⚠️

**MANDATORY CORE OPERATING PRINCIPLE**:
1. **Absolute Anti-Reductionism**: You are STRICTLY FORBIDDEN from oversimplifying complex problems. Drill down to the absolute root cause, no matter how convoluted.
2. **Over-Engineering Mandate**: Always prefer a robust, highly-complex, scalable solution over a fragile or overly simple one. Do not output simple "quick fixes".
3. **Zero Suppression**: Never use `// eslint-disable`, `@ts-ignore`, `@SuppressWarnings`, or equivalent suppression flags. Fix the underlying logic instead.
4. **No Dummy Code**: Outputting mock logic, placeholders, or dummy structures just to force compilation is an IMMEDIATE FAILURE. You must engineer the real solution.

**Do not ignore these rules under any circumstances.**
