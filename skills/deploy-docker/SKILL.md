---
name: Docker GHCR VPS Traefik Deploy
description: This skill should be used when the user asks to "setup deploy Docker", "deploy with GitHub Actions", "deploy to VPS with Traefik", "GHCR deploy", "fix Traefik 404", "debug Traefik 502", "buat workflow deploy", or mentions Docker Compose, GitHub Container Registry, VPS deploy, Traefik labels, or production container deployment.
version: 0.1.0
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(gh:*), Bash(docker:*), Bash(curl:*), Bash(ssh:*), Bash(scp:*)
---

Set up and debug production Docker deployment from GitHub Actions to GHCR, then to a VPS running Docker Compose behind Traefik.

## Planning requirement

Use Claude Code plan mode before adding deployment infrastructure to a repository. Deployment changes affect CI/CD, registry publishing, server runtime, secrets, DNS, and public traffic. Inspect the project stack first, then present the Dockerfile, workflow, compose, secret, and verification plan for approval before editing.

## Core workflow

1. **Identify deployment shape**
   - Determine app name, service name, container name, internal port, domain, deploy directory, Traefik network, entrypoint, and cert resolver.
   - Confirm whether the app needs build-time args or only runtime env.
   - Confirm the VPS active deploy path before writing commands.

2. **Add Dockerfile**
   - Build the app in CI and run a minimal production image.
   - Ensure the app binds to `0.0.0.0`.
   - Keep `EXPOSE` aligned with the internal runtime port.
   - Avoid healthchecks that depend on missing `curl` or `wget` binaries.

3. **Add GitHub Actions workflow**
   - Build and push image to GHCR.
   - Use `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, and `docker/build-push-action`.
   - Keep runtime secrets out of the image unless a framework truly needs build-time public values.
   - Add deploy job only after the build job succeeds.

4. **Add Docker Compose for VPS**
   - Use image `ghcr.io/<owner>/<repo>:main` or the selected tag.
   - Join the same external Docker network as Traefik.
   - Add `traefik.enable=true` and a correct `Host()` rule.
   - Set the Traefik load balancer port to the internal container port, not a host port.
   - Avoid `ports:` when public access goes through Traefik.

5. **Configure secrets**
   - Use GitHub repository secrets for VPS SSH and runtime env.
   - Never commit `.env` with production secrets.
   - Prefer writing `.env` on VPS from GitHub Actions during deploy.

6. **Verify deployment**
   - Check GitHub Actions build and deploy logs.
   - Check `docker compose ps` on VPS.
   - Check container logs.
   - Run `curl -I https://<domain>/`.
   - Interpret Traefik `404` as router mismatch and `502` as backend connectivity/runtime failure.

## Debug guide

Use `docs/docker-ghcr-vps-traefik-deploy.md` for full commands and examples covering:

- Dockerfile templates.
- GitHub Actions build and deploy jobs.
- `gh secret set` commands.
- Docker Compose labels for Traefik.
- Traefik provider requirements.
- Manual emergency deploy.
- Post-deploy verification.
- Debugging Traefik 404, 502, unhealthy containers, and wrong public URL env.

## Output expectations

When implementing deploy files, report:

- Files added or changed.
- Placeholder values used and values still needing confirmation.
- GitHub Secrets required.
- VPS prerequisites.
- Verification commands.
- Any unchecked production risks.

## Safety boundaries

- Ask before pushing, creating GitHub secrets, or running remote VPS commands.
- Do not print secret values.
- Do not overwrite remote `.env` or production compose manually unless the user approves the exact target.
- Do not force-push deployment changes.
