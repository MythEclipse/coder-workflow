---
description: Setup deklarasi wajib CodeGraph di CLAUDE.md
argument-hint: [claude-file-path-optional]
allowed-tools: Read, Edit, Write
model: sonnet
---

Tujuan: pastikan instruksi penggunaan CodeGraph tertulis di `CLAUDE.md` agar workflow graph-first konsisten.

## Gerbang keras: Prasyarat

1. Tentukan target file:
   - Jika user memberi argumen path, pakai path itu sebagai file target.
   - Jika tidak ada argumen, pakai `CLAUDE.md` di root project aktif.
2. Verifikasi path valid dan accessible.

## Fase 1: Inspeksi & Deteksi

1. Cek apakah file target ada.
   - Jika ada, baca isinya penuh.
   - Jika belum ada, catat bahwa file akan dibuat baru.
2. Cari section dengan heading persis: `## CodeGraph Usage (Required)`
3. Jika section ada, catat:
   - Posisi dalam file (line number).
   - Isi saat ini.
   - Apakah sudah mencakup semua elemen wajib (lihat Fase 2).
4. Jika section belum ada, catat bahwa section akan ditambahkan di akhir file.

## Fase 2: Verifikasi Konten Wajib

Section `## CodeGraph Usage (Required)` harus mencakup semua elemen ini:

- **graph-first rule**: "Use CodeGraph first for repo-level questions"
- **scan when stale/missing**: "If graph is missing or stale, run scan first"
- **workflow flow**: Urutan scan → query → analyze → export → open-ui
- **anti broad grep/find**: "Avoid broad grep/find or repeated wide file reads before graph lookup"

Jika section ada tapi incomplete, tandai elemen mana yang hilang.

## Fase 3: Update atau Buat

**Jika file belum ada:**
1. Buat file baru dengan header `# CLAUDE.md`.
2. Tambahkan section CodeGraph Usage (Required) dengan konten lengkap di bawah.

**Jika file ada tapi section belum ada:**
1. Jangan ubah konten existing — preserve semua instruksi user lain.
2. Tambahkan section CodeGraph Usage (Required) di akhir file.
3. Catat section mana yang sudah ada sebelumnya.

**Jika file ada dan section sudah ada:**
1. Jangan duplikasi section.
2. Verifikasi isi mencakup semua elemen wajib (Fase 2).
3. Jika ada elemen hilang, update section untuk include elemen tersebut.
4. Jika section sudah lengkap, tidak perlu ubah.

**Konten section CodeGraph Usage (Required) yang wajib:**

```md
## CodeGraph Usage (Required)

- Use CodeGraph first for repo-level questions: architecture, dependencies, references, callers/callees, impact, flow, routes, components.
- If graph is missing or stale, run scan first to refresh `.codegraph/graph.db`.
- Prefer graph-backed flow:
  1. scan-codegraph (build/refresh graph)
  2. query-codegraph (find definitions/references/callers/dependencies)
  3. analyze-codegraph (architecture, impact, risk, cycles, orphans, hotspots; also pre-flight for modular-mvc-refactor)
  4. export-codegraph (json/mermaid/dot/markdown/html when needed)
  5. open-codegraph-ui (interactive visualization when requested)
- Avoid broad grep/find or repeated wide file reads before graph lookup, except for exact literal search or known single-file edits.
```

## Fase 4: Verifikasi & Output

Setelah update:

1. Baca file target kembali untuk verifikasi perubahan.
2. Pastikan section CodeGraph Usage (Required) ada dan lengkap.
3. Pastikan tidak ada duplikasi section.
4. Pastikan konten user lain tidak berubah (jika file sudah ada).

Output wajib:

- **File target**: path absolut ke CLAUDE.md
- **Status**: "created" atau "updated"
- **Section status**: "added" atau "already present"
- **Changed sections**: daftar section yang dimodifikasi (jika ada)
- **Verification**: konfirmasi section CodeGraph Usage (Required) lengkap dan tidak duplikasi

Jika file sudah ada dan section sudah lengkap, output: "No changes needed — section already complete."
