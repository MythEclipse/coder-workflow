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
