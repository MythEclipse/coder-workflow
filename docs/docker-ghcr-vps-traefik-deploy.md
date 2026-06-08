# General Docker Deploy Guide: GitHub Actions → GHCR → VPS → Traefik

This document is a general template for deploying Docker applications from a GitHub repository to a VPS using GitHub Actions, GitHub Container Registry (GHCR), Docker Compose, and Traefik reverse proxy.

Use the following placeholders when copying to another repo:

| Placeholder | Example | Description |
| --- | --- | --- |
| `<app-name>` | `docker-manager` | Repository/project name |
| `<service-name>` | `app` / `orchestra` | Service name in `docker-compose.yml` |
| `<container-name>` | `docker-manager-app` | Docker container name |
| `<image>` | `ghcr.io/mytheclipse/docker-manager:main` | Image registry pulled by the VPS |
| `<domain>` | `docker.asepharyana.tech` | Application public domain |
| `<deploy-dir>` | `/opt/docker-manager` | Active project directory on VPS |
| `<network>` | `app-shared-net` | Docker network used by Traefik |
| `<internal-port>` | `3000` | Application port inside the container |
| `<entrypoint>` | `websecure` | Traefik entrypoint HTTPS |
| `<certresolver>` | `letsencrypt` | Traefik cert resolver |

## Main Principles

1. Build the image in CI, do not build manually on the VPS except in emergencies.
2. Push the image to a registry, e.g. GHCR.
3. The VPS only does `git pull`, writes `.env`, `docker compose pull`, then `docker compose up -d`.
4. Traefik will only route containers that:
   - are on the same network as Traefik,
   - have `traefik.enable=true`,
   - have a host rule matching the domain,
   - have the correct service port.
5. Always deploy from the active project directory on the VPS, not from a temporary compose file in another directory.

## 1. Dockerfile

Dockerfile must produce a production image that runs the application on a stable internal port, e.g. `3000`.

Example of a common pattern for web applications:

```dockerfile
FROM <runtime-image> AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/<build-output> ./
EXPOSE 3000
CMD ["npm", "start"]
```

Adjust the following sections for each framework/runtime:

- Node/Next.js: you can use standalone output.
- Bun: use `oven/bun` and `bun server.js` / `bun start`.
- Go/Rust: copy the final binary to a minimal image.
- Python: install dependencies and run an ASGI/WSGI server.

Dockerfile Checklist:

- Application binds to `0.0.0.0`, not just `localhost`.
- `EXPOSE` matches the internal application port.
- Minimal runtime env is available (`NODE_ENV`, `PORT`, and other required env vars).
- Build-time secrets are only used if actually needed during the build.
- Do not rely on healthcheck commands like `wget`/`curl` if the runtime image does not provide them.

## 2. GitHub Actions build image

Common workflow: `.github/workflows/deploy.yml`.

Example build to GHCR:

```yaml
name: Build and Deploy

on:
  push:
    branches:
      - main
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=sha

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

If the application requires build args:

```yaml
          build-args: |
            PUBLIC_BASE_URL=${{ secrets.PUBLIC_BASE_URL }}
            AUTH_URL=${{ secrets.AUTH_URL }}
```

Notes:

- Do not include runtime secrets in the image if they are not required for the build.
- Runtime secrets are safer to write to `.env` on the VPS during deployment.
- The `main` branch tag usually produces the image `ghcr.io/<owner>/<repo>:main`.

## 3. GitHub Actions deploy to VPS

The deploy job usually runs after the build succeeds.

Commonly required secrets:

```env
VPS_HOST=<ip-or-host>
VPS_USER=root
VPS_SSH_KEY=<private-key>
VPS_PORT=22
```

Example deploy job:

```yaml
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: read

    steps:
      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT || 22 }}
          script: |
            cd <deploy-dir>
            git pull origin main

            cat > .env << 'ENVEOF'
            APP_ENV=production
            APP_URL=https://<domain>
            DATABASE_URL=${{ secrets.DATABASE_URL }}
            AUTH_SECRET=${{ secrets.AUTH_SECRET }}
            ENVEOF

            docker login ghcr.io -u ${{ github.actor }} -p ${{ secrets.GITHUB_TOKEN }}
            docker network create <network> 2>/dev/null || true
            docker compose pull
            docker compose up -d
            docker compose ps

            docker compose ps | grep -q "<service-name>.*Up" || exit 1
```

Deploy job checklist:

- `cd <deploy-dir>` must point to the active directory on the VPS.
- `.env` is rewritten from GitHub Secrets so that runtime envs are consistent.
- Traefik network is created if it does not exist.
- `docker compose pull` is required so the VPS fetches the latest image from the registry.
- `docker compose up -d` must be run from the same directory as the active `docker-compose.yml`.

## 4. Setup GitHub Secrets via gh CLI

Before GitHub Actions can deploy, fill in all the repository secrets used by the workflow. The fastest way is to use the GitHub CLI (`gh`).

Login first if you haven't already:

```bash
gh auth login
```

Make sure you are in the correct repository root, then check existing secrets:

```bash
gh secret list
```

Set VPS secrets:

```bash
gh secret set VPS_HOST --body "<vps-host>"
gh secret set VPS_USER --body "<vps-user>"
gh secret set VPS_PORT --body "22"
gh secret set VPS_SSH_KEY < ~/.ssh/id_ed25519
```

If the private key is at a different path, replace `~/.ssh/id_ed25519` with the private key file used for SSH to the VPS. Do not use the `.pub` public key.

Set application secrets:

```bash
gh secret set DATABASE_URL --body "<database-url>"
gh secret set AUTH_SECRET --body "<auth-secret>"
gh secret set AUTH_URL --body "https://<domain>"
```

Add other secrets as required by the application, for example:

```bash
gh secret set APP_URL --body "https://<domain>"
gh secret set BASE_URL --body "https://<domain>"
gh secret set API_TOKEN --body "<token>"
```

For a specific repo without needing to `cd` into the repo folder:

```bash
gh secret set VPS_HOST --repo <owner>/<repo> --body "<vps-host>"
gh secret list --repo <owner>/<repo>
```

For multiline secrets like private keys, it is safer to use file redirect:

```bash
gh secret set VPS_SSH_KEY --repo <owner>/<repo> < ~/.ssh/id_ed25519
```

Verify that all secrets required by the workflow are registered:

```bash
gh secret list
```

Important notes:

- `gh secret list` only shows secret names, not their values.
- If a secret is filled incorrectly, run `gh secret set` again with the same name to overwrite it.
- Make sure `AUTH_URL`, `APP_URL`, `BASE_URL`, or similar envs use the production public domain, not `localhost`.
- Make sure the public key from the SSH private key is already in the VPS user's `~/.ssh/authorized_keys`.

## 5. docker-compose.yml general

Use Compose like this for a web service behind Traefik:

```yaml
networks:
  <network>:
    external: true
    name: "<network>"

services:
  <service-name>:
    image: <image>
    container_name: <container-name>
    restart: always
    networks:
      - <network>
    environment:
      NODE_ENV: production
      PORT: <internal-port>
    env_file:
      - .env
    labels:
      "traefik.enable": "true"
      "traefik.http.routers.<router-name>.rule": "Host(`<domain>`)"
      "traefik.http.routers.<router-name>.entrypoints": "<entrypoint>"
      "traefik.http.routers.<router-name>.tls": "true"
      "traefik.http.routers.<router-name>.tls.certresolver": "<certresolver>"
      "traefik.http.services.<service-name>.loadbalancer.server.port": "<internal-port>"
```

Concrete example:

```yaml
networks:
  app-shared-net:
    external: true
    name: "app-shared-net"

services:
  app:
    image: ghcr.io/mytheclipse/example-app:main
    container_name: example-app
    restart: always
    networks:
      - app-shared-net
    environment:
      NODE_ENV: production
      PORT: 3000
    env_file:
      - .env
    labels:
      "traefik.enable": "true"
      "traefik.http.routers.example-app.rule": "Host(`example.asepharyana.tech`)"
      "traefik.http.routers.example-app.entrypoints": "websecure"
      "traefik.http.routers.example-app.tls": "true"
      "traefik.http.routers.example-app.tls.certresolver": "letsencrypt"
      "traefik.http.services.example-app.loadbalancer.server.port": "3000"
```

Compose notes:

- `version` can be omitted in modern Docker Compose; if present, it usually only shows an obsolete warning.
- Use `external: true` if the network is created and shared by Traefik.
- Traefik router and service names must be unique per application.
- The port in the Traefik label is the container internal port, not the host port.
- There is no need to publish `ports:` if public access goes through Traefik.
- Avoid healthchecks that depend on tools that may not be present in the image (`wget`, `curl`). If you still need a healthcheck, make sure the command is available and the endpoint is correct.

## 6. Traefik requirement

Traefik with Docker provider minimally needs configuration like this:

```text
--providers.docker=true
--providers.docker.exposedByDefault=false
--providers.docker.network=<network>
--providers.docker.watch=true
--entryPoints.web.address=:80
--entryPoints.websecure.address=:443
```

If using HTTP to HTTPS redirect:

```text
--entryPoints.web.http.redirections.entryPoint.to=websecure
--entryPoints.web.http.redirections.entryPoint.scheme=https
```

Important implications:

- All apps that want to be routed by Traefik must join `<network>`.
- If `exposedByDefault=false`, every app must have the `traefik.enable=true` label.
- The domain must point to the VPS IP via DNS.
- If Cloudflare is in front, make sure the SSL mode and DNS record are configured as needed.

## 7. Manual deploy from local to VPS

Use manual deploy only for emergencies/debugging or when CI is not yet ready.

Upload compose to the active directory:

```bash
scp docker-compose.yml <vps-user>@<vps-host>:<deploy-dir>/docker-compose.yml
```

Restart service from the active directory:

```bash
ssh <vps-user>@<vps-host> "cd <deploy-dir> && docker compose up -d --pull always <service-name>"
```

Example:

```bash
scp docker-compose.yml root@45.127.35.244:/opt/example-app/docker-compose.yml
ssh root@45.127.35.244 "cd /opt/example-app && docker compose up -d --pull always app"
```

Do not copy to a path that is not used by deployment, e.g. `/root/docker-compose.yml`, unless the active compose project is actually there.

## 8. Verification After Deploy

Check container:

```bash
ssh <vps-user>@<vps-host> "docker ps --filter name=<container-name> --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
```

Check application logs:

```bash
ssh <vps-user>@<vps-host> "docker logs --tail 100 <container-name>"
```

Check domain:

```bash
curl -I https://<domain>/
```

Expected response depends on the application:

- `200 OK`: homepage appears directly.
- `301/302/307/308`: normal if the application redirects to login/dashboard.
- `401/403`: normal if the route requires auth.
- `404 page not found` from Traefik: router does not match or container is not registered in Traefik.
- `502 Bad Gateway`: Traefik found the router but cannot connect to the service/port.

## 9. Debug Traefik 404

If the domain returns `404 page not found`, the request usually reaches Traefik but no router matches.

Check container labels:

```bash
ssh <vps-user>@<vps-host> "docker inspect <container-name> --format '{{json .Config.Labels}}'"
```

Make sure these labels exist:

```text
traefik.enable=true
traefik.http.routers.<router-name>.rule=Host(`<domain>`)
traefik.http.routers.<router-name>.entrypoints=<entrypoint>
traefik.http.routers.<router-name>.tls=true
traefik.http.services.<service-name>.loadbalancer.server.port=<internal-port>
```

Check network:

```bash
ssh <vps-user>@<vps-host> "docker network inspect <network>"
```

Make sure the application container and the Traefik container are both on that network.

Check Traefik command/config:

```bash
ssh <vps-user>@<vps-host> "docker inspect traefik --format '{{json .Config.Cmd}}'"
```

Look for:

```text
--providers.docker=true
--providers.docker.network=<network>
--providers.docker.exposedByDefault=false
```

Check Traefik logs:

```bash
ssh <vps-user>@<vps-host> "docker logs --tail 200 traefik 2>&1 | grep -E '<router-name>|<domain>|error|ERR|warn|WRN' || true"
```

Common causes of 404:

- Compose was edited in the wrong path.
- Container was not recreated after label changes.
- Container did not join the Traefik network.
- `Host()` label has wrong domain, backtick typo, or wrong router name.
- `traefik.enable` is missing or set to false.
- Traefik provider is using a different network.
- DNS domain does not point to the VPS running Traefik.

## 10. Debug Traefik 502

If the domain returns `502 Bad Gateway`, the router has matched but the backend is unreachable.

Check:

```bash
ssh <vps-user>@<vps-host> "docker logs --tail 100 <container-name>"
ssh <vps-user>@<vps-host> "docker inspect <container-name> --format '{{json .NetworkSettings.Networks}}'"
```

Common causes of 502:

- Application crashed or is not ready.
- Application binds to `127.0.0.1`, not `0.0.0.0`.
- `loadbalancer.server.port` label is wrong.
- Container is not listening on the claimed port.
- Runtime env is insufficient, causing the application to fail to start.

## 11. Debug container unhealthy

If the container is `unhealthy`, Traefik may ignore the container or consider the service not ready.

Check healthcheck details:

```bash
ssh <vps-user>@<vps-host> "docker inspect <container-name> --format '{{json .State.Health}}'"
```

Common causes:

- Healthcheck uses `curl`/`wget`, but the binary is not in the image.
- Healthcheck endpoint is wrong.
- App needs more startup time than `start_period`.
- Healthcheck targets `localhost`/port that does not match the app runtime.

If the healthcheck is not important for routing, remove it from compose. If needed, use an endpoint and command that are definitely available in the image.

## 12. Env and Public URL

For auth/callback applications, make sure the public URL env is correct.

Examples:

```env
APP_URL=https://<domain>
BASE_URL=https://<domain>
AUTH_URL=https://<domain>
NEXTAUTH_URL=https://<domain>
```

Env names depend on the framework/library.

Symptoms of incorrect URL env:

- Cookie callback points to `localhost`.
- Login redirect goes to the development domain.
- OAuth callback mismatch.
- Absolute links in the UI point to the wrong host.

If deploying via GitHub Actions, check the values at:

1. GitHub Repository Secrets.
2. `.env` written on the VPS.
3. Runtime env inside the container:

```bash
ssh <vps-user>@<vps-host> "docker exec <container-name> env | grep -E 'URL|HOST|AUTH|BASE'"
```

## 13. Final Checklist Per Repo

Before considering the deployment complete:

- [ ] GitHub Actions build succeeded.
- [ ] Latest image is in the registry.
- [ ] VPS deploys from the correct `<deploy-dir>`.
- [ ] VPS `.env` contains the correct runtime secrets.
- [ ] `docker compose pull` fetches the latest image.
- [ ] Container status is `Up`.
- [ ] Container is not `unhealthy`, unless a healthcheck is not yet in use.
- [ ] Container joined the Traefik network.
- [ ] Traefik labels are active and the domain is correct.
- [ ] `curl -I https://<domain>/` no longer returns Traefik `404`.
- [ ] Auth/callback URL does not point to `localhost`.

## 14. Case Study: Docker Manager Traefik 404

Example of a problem that occurred:

- Domain `https://docker.asepharyana.tech/` returned Traefik `404 page not found`.
- Compose was copied to `/root/docker-compose.yml`, while the active project on VPS uses `/opt/docker-manager/docker-compose.yml`.
- Container `orchestra-docker-manager` was `unhealthy` due to a healthcheck.
- After the compose file in the active path was fixed, the healthcheck was removed, and the service was recreated from `/opt/docker-manager`, the domain changed to `HTTP/2 307` redirect to `/dashboard`.

Lessons applicable to other repos:

1. Always make sure the active compose path on the VPS is correct.
2. Compare labels with other services that are already successfully routed by Traefik.
3. Do not just check that the container is `Up`; also verify that Traefik is reading the correct labels and network.
4. Traefik `404` response means the router does not match; `502` response means the router matches but the backend has an issue.
