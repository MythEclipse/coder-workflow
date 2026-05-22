# General Docker Deploy Guide: GitHub Actions → GHCR → VPS → Traefik

Dokumen ini adalah template umum untuk deploy aplikasi Docker dari repository GitHub ke VPS menggunakan GitHub Actions, GitHub Container Registry (GHCR), Docker Compose, dan Traefik reverse proxy.

Gunakan placeholder berikut saat menyalin ke repo lain:

| Placeholder | Contoh | Keterangan |
| --- | --- | --- |
| `<app-name>` | `docker-manager` | Nama repo/proyek |
| `<service-name>` | `app` / `orchestra` | Nama service di `docker-compose.yml` |
| `<container-name>` | `docker-manager-app` | Nama container Docker |
| `<image>` | `ghcr.io/mytheclipse/docker-manager:main` | Image registry yang dipull VPS |
| `<domain>` | `docker.asepharyana.tech` | Domain publik aplikasi |
| `<deploy-dir>` | `/opt/docker-manager` | Direktori aktif project di VPS |
| `<network>` | `app-shared-net` | Docker network yang dipakai Traefik |
| `<internal-port>` | `3000` | Port aplikasi di dalam container |
| `<entrypoint>` | `websecure` | Traefik entrypoint HTTPS |
| `<certresolver>` | `letsencrypt` | Traefik cert resolver |

## Prinsip utama

1. Build image di CI, jangan build manual di VPS kecuali darurat.
2. Push image ke registry, misalnya GHCR.
3. VPS hanya melakukan `git pull`, menulis `.env`, `docker compose pull`, lalu `docker compose up -d`.
4. Traefik hanya akan route container yang:
   - berada di network yang sama dengan Traefik,
   - punya `traefik.enable=true`,
   - punya rule host yang cocok dengan domain,
   - punya service port yang benar.
5. Selalu deploy dari direktori aktif project di VPS, bukan dari file compose sementara di direktori lain.

## 1. Dockerfile

Dockerfile harus menghasilkan image production yang menjalankan aplikasi pada port internal yang stabil, misalnya `3000`.

Contoh pola umum untuk aplikasi web:

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

Sesuaikan bagian berikut untuk framework/runtime masing-masing:

- Node/Next.js: bisa memakai standalone output.
- Bun: pakai `oven/bun` dan `bun server.js` / `bun start`.
- Go/Rust: copy binary final ke image minimal.
- Python: install dependency dan jalankan ASGI/WSGI server.

Checklist Dockerfile:

- Aplikasi bind ke `0.0.0.0`, bukan hanya `localhost`.
- `EXPOSE` sama dengan port internal aplikasi.
- Runtime env minimal tersedia (`NODE_ENV`, `PORT`, dan env lain yang diperlukan).
- Build-time secret hanya dipakai jika memang diperlukan saat build.
- Jangan bergantung pada command healthcheck seperti `wget`/`curl` jika image runtime tidak menyediakannya.

## 2. GitHub Actions build image

Workflow umum: `.github/workflows/deploy.yml`.

Contoh build ke GHCR:

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

Jika aplikasi membutuhkan build args:

```yaml
          build-args: |
            PUBLIC_BASE_URL=${{ secrets.PUBLIC_BASE_URL }}
            AUTH_URL=${{ secrets.AUTH_URL }}
```

Catatan:

- Jangan memasukkan secret runtime ke image jika tidak wajib untuk build.
- Secret runtime lebih aman ditulis ke `.env` di VPS saat deploy.
- Tag branch `main` biasanya menghasilkan image `ghcr.io/<owner>/<repo>:main`.

## 3. GitHub Actions deploy ke VPS

Deploy job biasanya berjalan setelah build berhasil.

Secrets yang umum dibutuhkan:

```env
VPS_HOST=<ip-or-host>
VPS_USER=root
VPS_SSH_KEY=<private-key>
VPS_PORT=22
```

Contoh deploy job:

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

Checklist deploy job:

- `cd <deploy-dir>` harus menunjuk ke direktori aktif di VPS.
- `.env` ditulis ulang dari GitHub Secrets agar runtime env konsisten.
- Network Traefik dibuat jika belum ada.
- `docker compose pull` wajib agar VPS mengambil image terbaru dari registry.
- `docker compose up -d` harus dijalankan dari direktori yang sama dengan `docker-compose.yml` aktif.

## 4. Setup GitHub Secrets via gh CLI

Sebelum GitHub Actions bisa deploy, isi semua repository secrets yang dipakai workflow. Cara paling cepat adalah memakai GitHub CLI (`gh`).

Login dulu jika belum:

```bash
gh auth login
```

Pastikan sedang berada di root repository yang benar, lalu cek secrets yang sudah ada:

```bash
gh secret list
```

Set secrets VPS:

```bash
gh secret set VPS_HOST --body "<vps-host>"
gh secret set VPS_USER --body "<vps-user>"
gh secret set VPS_PORT --body "22"
gh secret set VPS_SSH_KEY < ~/.ssh/id_ed25519
```

Jika private key berada di path lain, ganti `~/.ssh/id_ed25519` sesuai file private key yang dipakai untuk SSH ke VPS. Jangan gunakan public key `.pub`.

Set secrets aplikasi:

```bash
gh secret set DATABASE_URL --body "<database-url>"
gh secret set AUTH_SECRET --body "<auth-secret>"
gh secret set AUTH_URL --body "https://<domain>"
```

Tambahkan secret lain sesuai kebutuhan aplikasi, misalnya:

```bash
gh secret set APP_URL --body "https://<domain>"
gh secret set BASE_URL --body "https://<domain>"
gh secret set API_TOKEN --body "<token>"
```

Untuk repo tertentu tanpa harus `cd` ke folder repo:

```bash
gh secret set VPS_HOST --repo <owner>/<repo> --body "<vps-host>"
gh secret list --repo <owner>/<repo>
```

Untuk secret multiline seperti private key, lebih aman pakai redirect file:

```bash
gh secret set VPS_SSH_KEY --repo <owner>/<repo> < ~/.ssh/id_ed25519
```

Verifikasi semua secret yang dibutuhkan workflow sudah terdaftar:

```bash
gh secret list
```

Catatan penting:

- `gh secret list` hanya menampilkan nama secret, bukan nilainya.
- Jika secret salah isi, jalankan `gh secret set` lagi dengan nama yang sama untuk overwrite.
- Pastikan `AUTH_URL`, `APP_URL`, `BASE_URL`, atau env sejenis memakai domain publik production, bukan `localhost`.
- Pastikan public key dari private key SSH sudah ada di `~/.ssh/authorized_keys` user VPS.

## 5. docker-compose.yml general

Gunakan Compose seperti ini untuk service web di belakang Traefik:

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

Contoh konkret:

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

Catatan Compose:

- `version` boleh dihapus pada Docker Compose modern; jika ada, biasanya hanya memunculkan warning obsolete.
- Gunakan `external: true` jika network dibuat dan dipakai bersama oleh Traefik.
- Nama router dan service Traefik harus unik per aplikasi.
- Port di label Traefik adalah port internal container, bukan port host.
- Tidak perlu publish `ports:` jika akses publik lewat Traefik.
- Hindari healthcheck yang bergantung pada tool yang belum tentu ada di image (`wget`, `curl`). Jika tetap butuh healthcheck, pastikan command tersedia dan endpoint benar.

## 6. Traefik requirement

Traefik dengan Docker provider minimal perlu konfigurasi seperti ini:

```text
--providers.docker=true
--providers.docker.exposedByDefault=false
--providers.docker.network=<network>
--providers.docker.watch=true
--entryPoints.web.address=:80
--entryPoints.websecure.address=:443
```

Jika memakai redirect HTTP ke HTTPS:

```text
--entryPoints.web.http.redirections.entryPoint.to=websecure
--entryPoints.web.http.redirections.entryPoint.scheme=https
```

Implikasi penting:

- Semua app yang ingin diroute Traefik harus join `<network>`.
- Jika `exposedByDefault=false`, setiap app wajib punya label `traefik.enable=true`.
- Domain harus mengarah ke IP VPS lewat DNS.
- Jika ada Cloudflare di depan, pastikan SSL mode dan DNS record sesuai kebutuhan.

## 7. Manual deploy dari lokal ke VPS

Gunakan manual deploy hanya untuk emergency/debug atau saat CI belum siap.

Upload compose ke direktori aktif:

```bash
scp docker-compose.yml <vps-user>@<vps-host>:<deploy-dir>/docker-compose.yml
```

Restart service dari direktori aktif:

```bash
ssh <vps-user>@<vps-host> "cd <deploy-dir> && docker compose up -d --pull always <service-name>"
```

Contoh:

```bash
scp docker-compose.yml root@45.127.35.244:/opt/example-app/docker-compose.yml
ssh root@45.127.35.244 "cd /opt/example-app && docker compose up -d --pull always app"
```

Jangan copy ke path yang tidak dipakai deployment, misalnya `/root/docker-compose.yml`, kecuali memang compose project aktif ada di sana.

## 8. Verifikasi setelah deploy

Cek container:

```bash
ssh <vps-user>@<vps-host> "docker ps --filter name=<container-name> --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
```

Cek log aplikasi:

```bash
ssh <vps-user>@<vps-host> "docker logs --tail 100 <container-name>"
```

Cek domain:

```bash
curl -I https://<domain>/
```

Expected response tergantung aplikasi:

- `200 OK`: homepage langsung tampil.
- `301/302/307/308`: normal jika aplikasi redirect ke login/dashboard.
- `401/403`: normal jika route memang butuh auth.
- `404 page not found` dari Traefik: router tidak match atau container tidak terdaftar di Traefik.
- `502 Bad Gateway`: Traefik menemukan router, tapi tidak bisa connect ke service/port.

## 9. Debug Traefik 404

Jika domain mengembalikan `404 page not found`, biasanya request sampai ke Traefik tetapi tidak ada router yang match.

Cek label container:

```bash
ssh <vps-user>@<vps-host> "docker inspect <container-name> --format '{{json .Config.Labels}}'"
```

Pastikan ada label:

```text
traefik.enable=true
traefik.http.routers.<router-name>.rule=Host(`<domain>`)
traefik.http.routers.<router-name>.entrypoints=<entrypoint>
traefik.http.routers.<router-name>.tls=true
traefik.http.services.<service-name>.loadbalancer.server.port=<internal-port>
```

Cek network:

```bash
ssh <vps-user>@<vps-host> "docker network inspect <network>"
```

Pastikan container aplikasi dan container Traefik sama-sama ada di network tersebut.

Cek command/config Traefik:

```bash
ssh <vps-user>@<vps-host> "docker inspect traefik --format '{{json .Config.Cmd}}'"
```

Cari:

```text
--providers.docker=true
--providers.docker.network=<network>
--providers.docker.exposedByDefault=false
```

Cek log Traefik:

```bash
ssh <vps-user>@<vps-host> "docker logs --tail 200 traefik 2>&1 | grep -E '<router-name>|<domain>|error|ERR|warn|WRN' || true"
```

Penyebab umum 404:

- Compose diedit di path yang salah.
- Container belum direcreate setelah label berubah.
- Container tidak join network Traefik.
- `Host()` label salah domain, typo backtick, atau salah router name.
- `traefik.enable` tidak ada atau bernilai false.
- Traefik provider memakai network lain.
- DNS domain belum mengarah ke VPS yang menjalankan Traefik.

## 10. Debug Traefik 502

Jika domain mengembalikan `502 Bad Gateway`, router sudah match tetapi backend tidak bisa diakses.

Cek:

```bash
ssh <vps-user>@<vps-host> "docker logs --tail 100 <container-name>"
ssh <vps-user>@<vps-host> "docker inspect <container-name> --format '{{json .NetworkSettings.Networks}}'"
```

Penyebab umum 502:

- Aplikasi crash atau belum siap.
- Aplikasi bind ke `127.0.0.1`, bukan `0.0.0.0`.
- Label `loadbalancer.server.port` salah.
- Container tidak listen pada port yang diklaim.
- Runtime env kurang sehingga aplikasi gagal start.

## 11. Debug container unhealthy

Jika container `unhealthy`, Traefik bisa mengabaikan container atau service dianggap tidak siap.

Cek healthcheck detail:

```bash
ssh <vps-user>@<vps-host> "docker inspect <container-name> --format '{{json .State.Health}}'"
```

Penyebab umum:

- Healthcheck memakai `curl`/`wget`, tapi binary tidak ada di image.
- Endpoint healthcheck salah.
- App butuh waktu start lebih lama dari `start_period`.
- Healthcheck ke `localhost`/port yang tidak sama dengan app runtime.

Jika healthcheck tidak penting untuk routing, hapus dulu dari compose. Jika perlu, gunakan endpoint dan command yang pasti tersedia di image.

## 12. Env dan URL publik

Untuk aplikasi auth/callback, pastikan env URL publik benar.

Contoh:

```env
APP_URL=https://<domain>
BASE_URL=https://<domain>
AUTH_URL=https://<domain>
NEXTAUTH_URL=https://<domain>
```

Nama env bergantung framework/library.

Gejala env URL salah:

- Cookie callback mengarah ke `localhost`.
- Login redirect ke domain development.
- OAuth callback mismatch.
- Link absolut di UI mengarah ke host yang salah.

Jika deploy lewat GitHub Actions, cek nilai di:

1. GitHub Repository Secrets.
2. `.env` yang ditulis di VPS.
3. Runtime env di container:

```bash
ssh <vps-user>@<vps-host> "docker exec <container-name> env | grep -E 'URL|HOST|AUTH|BASE'"
```

## 13. Checklist final per repo

Sebelum menganggap deploy selesai:

- [ ] GitHub Actions build berhasil.
- [ ] Image terbaru sudah ada di registry.
- [ ] VPS deploy dari `<deploy-dir>` yang benar.
- [ ] `.env` VPS berisi secret runtime yang benar.
- [ ] `docker compose pull` mengambil image terbaru.
- [ ] Container status `Up`.
- [ ] Container tidak `unhealthy`, kecuali memang healthcheck belum dipakai.
- [ ] Container join network Traefik.
- [ ] Label Traefik aktif dan domain benar.
- [ ] `curl -I https://<domain>/` tidak lagi mengembalikan Traefik `404`.
- [ ] Auth/callback URL tidak mengarah ke `localhost`.

## 14. Studi kasus: Docker Manager 404 Traefik

Contoh masalah yang pernah terjadi:

- Domain `https://docker.asepharyana.tech/` mengembalikan Traefik `404 page not found`.
- Compose sempat dicopy ke `/root/docker-compose.yml`, padahal project aktif di VPS memakai `/opt/docker-manager/docker-compose.yml`.
- Container `orchestra-docker-manager` sempat `unhealthy` karena healthcheck.
- Setelah compose di path aktif diperbaiki, healthcheck dihapus, dan service direcreate dari `/opt/docker-manager`, domain berubah menjadi `HTTP/2 307` redirect ke `/dashboard`.

Pelajaran yang bisa dipakai di repo lain:

1. Selalu pastikan path compose aktif di VPS.
2. Bandingkan label dengan service lain yang sudah berhasil diroute Traefik.
3. Jangan hanya melihat container `Up`; cek juga apakah Traefik membaca label dan network yang benar.
4. Response Traefik `404` berarti router tidak match; response `502` berarti router match tapi backend bermasalah.
