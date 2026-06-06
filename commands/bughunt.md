---
description: Proactive Bug Hunter — scan code untuk common bug patterns
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:debugging-engineer` subagent untuk memburu, mereproduksi, mengklasifikasi, dan mendokumentasikan bug di seluruh codebase. (Bug hunting telah digabung ke debugging-engineer — gunakan Phase 0 untuk discovery.)

Gunakan command ini ketika Anda ingin:
- Menemukan bug baru di codebase secara sistematis
- Memverifikasi bug yang dilaporkan dengan langkah reproduksi
- Mengklasifikasi severity dan tipe bug
- Melacak lifecycle bug dari open hingga verified-fixed
- Mendapatkan laporan bug terstruktur sebelum rilis

Bug Hunter Agent akan menjalankan 5 fase: eksplorasi & deteksi, verifikasi & reproduksi, klasifikasi & severity, dokumentasi & pelaporan, dan lifecycle tracking. Bug CRITICAL dan HIGH akan didelegasikan ke `debugging-engineer` untuk root-cause analysis.

Jika scope argument diberikan (misalnya path modul atau fitur), agent akan membatasi pencarian pada area tersebut. Jika tidak ada argument, agent akan menscan seluruh codebase.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it.
> - New tools: `mcp__codegraph__update_codebase`, `mcp__codegraph__diff_graphs`.
