---
description: Refactor codebase ke arsitektur Modular MVC + Service + Repository
argument-hint: [scope-optional]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(npm:*), Bash(node:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*), mcp__codegraph__*, mcp__code-review-graph__*
model: sonnet
---

Tujuan: transformasi codebase menuju arsitektur **Modular MVC + Service + Repository** tanpa
mengubah perilaku fungsional yang sudah ada. Kode diorganisir berdasarkan fitur (modul),
bukan berdasarkan layer global.

## Gerbang keras: Prasyarat

Sebelum mulai refactor, verifikasi:
1. Codebase dalam git state bersih: `git status` harus clean atau user konfirmasi uncommitted changes.
2. Semua test suite passing (gunakan ecosystem-detected command, lihat seksi Ecosystem Detection di bawah).
3. Typecheck clean (ecosystem-detected command).
4. CodeGraph graph fresh: `.codegraph/graph.db` ada dan tidak stale.

Jika ada prasyarat gagal, stop dan laporkan blocker. Jangan lanjut sampai user resolve.

## Ecosystem Detection (Wajib, Sebelum Fase 1)

Deteksi ekosistem project sebelum menjalankan command apapun. Baca file-file ini untuk menentukan toolchain:

```
Prioritas deteksi (cek keberadaan file):
1. package.json hadir → Node.js/TypeScript
   - Baca field "scripts" → gunakan perintah dari sana
   - ECOSYSTEM.test    = npm run test (atau yarn/pnpm/bun sesuai lockfile)
   - ECOSYSTEM.lint    = npm run lint (atau biome check / eslint)
   - ECOSYSTEM.typecheck = npm run typecheck (atau tsc --noEmit)

2. pyproject.toml / pytest.ini / setup.cfg hadir → Python
   - ECOSYSTEM.test    = pytest (atau python -m pytest)
   - ECOSYSTEM.lint    = ruff check . (atau flake8)
   - ECOSYSTEM.typecheck = mypy . (jika pyproject.toml punya [tool.mypy])

3. go.mod hadir → Go
   - ECOSYSTEM.test    = go test ./...
   - ECOSYSTEM.lint    = go vet ./...
   - ECOSYSTEM.typecheck = go build ./...

4. Cargo.toml hadir → Rust
   - ECOSYSTEM.test    = cargo test
   - ECOSYSTEM.lint    = cargo clippy
   - ECOSYSTEM.typecheck = cargo check

5. pom.xml hadir → Java/Maven
   - ECOSYSTEM.test    = mvn test
   - ECOSYSTEM.lint    = mvn checkstyle:check
   - ECOSYSTEM.typecheck = mvn compile

6. build.gradle / build.gradle.kts hadir → Java/Kotlin/Gradle
   - ECOSYSTEM.test    = ./gradlew test
   - ECOSYSTEM.lint    = ./gradlew ktlintCheck (jika ada) atau checkstyleMain
   - ECOSYSTEM.typecheck = ./gradlew classes
```

Jika tidak ada yang cocok: tanya user sebelum lanjut. Jangan assume npm.

Semua gerbang verifikasi di fase berikutnya menggunakan `{ECOSYSTEM.test}`, `{ECOSYSTEM.typecheck}`, dan `{ECOSYSTEM.lint}` — bukan perintah hardcoded.

## Fase 1: Recon & Deteksi

Sebelum ubah apapun:

1. Jalankan MCP tools (`summarize_architecture`, `find_cycles`, `find_orphans`) untuk arsitektur overview dan hotspot.
2. Identifikasi smells berikut dengan lokasi file + baris:

| Smell | Ciri | Layer bermasalah |
|-------|------|--------------------|
| Fat controller | Query ORM/SQL di controller | Controller |
| Missing repository | Service panggil ORM model langsung | Service |
| Schema-less | Validasi tersebar di controller/service | Tidak ada Schema |
| Layer leakage | Repository import `Request`/`Response` | Repository |
| Cross-module leak | Module A import repository Module B langsung | Antar modul |
| Flat layout | Semua controller di satu folder global `controllers/` | Struktur folder |

3. Jalankan `git status --short` untuk catat file aktif berubah — prioritaskan sebagai scope awal.
4. Output: **Recon report** dengan daftar pelanggaran per file, severity, dan scope refactor yang diusulkan.

User harus approve scope sebelum lanjut ke Fase 2.

## Fase 2: Stabilkan `shared/` terlebih dahulu

Sebelum sentuh modul apapun, reorganisir shared layer:

- Pindahkan koneksi DB / ORM setup → `shared/database/`
- Pindahkan loading env/config → `shared/config/`
- Pindahkan custom error class + error handler global → `shared/errors/`
- Pindahkan middleware generik (auth guard, rate limiter, logger) → `shared/middlewares/`
- Pindahkan pure utility function yang dipakai banyak modul → `shared/utils/`

**Gerbang verifikasi:**
- `shared/` tidak boleh import apapun dari `modules/`.
- Typecheck clean setelah setiap file pindah.
- Lint clean setelah setiap file pindah.

Jika ada import violation atau type error, stop dan perbaiki sebelum lanjut.

## Fase 3: Migrasi tiap modul

Untuk setiap fitur (user, auth, product, order, payment, dst.), ikuti urutan layer:

### Route file
- Hanya berisi deklarasi endpoint (HTTP method + path → controller method).
- Tidak ada logic apapun selain pemilihan middleware.
- Gerbang: Typecheck + lint clean.

### Controller file
- Hanya: parse request → panggil service → return response.
- Tidak boleh ada query DB, hashing, atau kalkulasi bisnis.
- Gerbang: Typecheck + lint clean.

### Service file
- Pusat logic aplikasi: keputusan bisnis, orchestrasi, validasi.
- Tidak menyentuh `req`/`res`.
- Tidak memanggil ORM/query langsung.
- Gerbang: Typecheck + lint clean.

### Repository file
- Semua ORM query / SQL di sini: find, create, update, delete, pagination, filter, join, transaksi.
- Satu method per operasi DB yang distinct.
- Return typed data, bukan HTTP types.
- Tidak boleh ada logic bisnis.
- Gerbang: Typecheck + lint clean.

### Schema file
- Validasi input di boundary request.
- Pasang sebagai middleware atau panggilan pertama di controller.
- Gerbang: Typecheck + lint clean.

### Cross-module rule
- Module A hanya boleh import dari service Module B, bukan controller atau repository-nya.
- Jika ada circular dependency antar modul, ekstrak ke `shared/utils/` atau buat domain service bersama.
- Gerbang: codegraph MCP harus tidak mendeteksi cross-module repository import.

## Fase 4: Verifikasi setelah tiap batch

Setelah setiap modul selesai, jalankan verifikasi penuh:

1. Typecheck: `{ECOSYSTEM.typecheck}` — harus clean.
2. Lint: `{ECOSYSTEM.lint}` — harus clean.
3. Test modul terpengaruh: gunakan `{ECOSYSTEM.test}` dengan filter nama modul jika didukung runner.
4. Test full suite: `{ECOSYSTEM.test}` — harus passing.
5. Impact check: codegraph MCP untuk verifikasi tidak ada caller tak terduga yang rusak.

Jika ada failure baru → stop, perbaiki dulu, baru lanjut ke modul berikutnya.

## Fase 5: Output & Ringkas hasil

Setelah seluruh scope selesai, output wajib:

1. **Architecture map sebelum** — daftar file dengan pelanggaran layer yang terdeteksi.
2. **Migration manifest** — tabel `path lama → path baru` untuk setiap file yang dipindah.
3. **Violation summary** — apa yang diperbaiki per jenis pelanggaran.
4. **Verification results** — hasil typecheck, lint, test pasca-refactor.
5. **Residual items** — area yang sengaja ditunda beserta alasannya.
6. **Next refactor targets** — kandidat prioritas tinggi untuk sesi berikutnya.

## Aturan penting (non-negotiable)

- **Jangan ubah perilaku fungsional.** Refactor struktur, bukan logika.
- **Jangan pakai `git reset --hard`, `git checkout --`, atau hapus massal tanpa persetujuan eksplisit user.**
- **Jangan tambah fitur baru selama refactor** kecuali user minta.
- **Jangan ubah API publik / kontrak eksternal tanpa konfirmasi.**
- **Jangan gunakan suppression flag** (`@ts-ignore`, `eslint-disable`, dll.) untuk sembunyikan type error. Perbaiki akar masalahnya.
- **Setiap warning typecheck atau lint diperlakukan sebagai error** — fix sebelum lanjut.
- Jika validasi penuh mahal, jalankan subset paling relevan dan laporkan batasannya.

## Anti-pattern yang wajib dieliminasi

- Controller yang import model ORM langsung dan memanggil `.findOne()`, `.save()`, `.create()`
- Service yang menerima atau mengakses `req`/`res`
- Repository yang berisi `if/else` keputusan bisnis
- Raw SQL string di dalam service atau controller
- Validation schema yang didefinisikan inline di dalam route handler
- Module B repository diimport langsung oleh Module A service
- `shared/` yang import dari `modules/` (arah dependency harus satu arah: modules → shared)

## Kontrak arsitektur target

Setiap fitur hidup dalam satu folder module. Alur request berjalan melalui lima layer berurutan:

```
Route → Controller → Service → Repository → Schema
```

### Struktur folder target

```
src/
├── main.ts
├── app.ts
│
├── modules/
│   ├── auth/
│   │   ├── auth.route.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.repository.ts
│   │   └── auth.schema.ts
│   │
│   ├── user/
│   │   ├── user.route.ts
│   │   ├── user.controller.ts
│   │   ├── user.service.ts
│   │   ├── user.repository.ts
│   │   └── user.schema.ts
│   │
│   ├── product/
│   │   ├── product.route.ts
│   │   ├── product.controller.ts
│   │   ├── product.service.ts
│   │   ├── product.repository.ts
│   │   └── product.schema.ts
│   │
│   └── order/
│       ├── order.route.ts
│       ├── order.controller.ts
│       ├── order.service.ts
│       ├── order.repository.ts
│       └── order.schema.ts
│
├── shared/
│   ├── database/
│   │   └── prisma.ts
│   │
│   ├── config/
│   │   └── env.ts
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.ts
│   │   ├── validate.middleware.ts
│   │   └── error.middleware.ts
│   │
│   ├── logger/
│   │   └── logger.ts
│   │
│   ├── helpers/
│   │   └── response.helper.ts
│   │
│   └── utils/
│       └── pagination.util.ts
│
└── types/
    └── express.d.ts
```


> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `view_file` or `Read` via explorer subagents instead.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools added: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare json states).
