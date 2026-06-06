---
description: Experience journal — lihat catatan pembelajaran, lessons learned, dan insight dari sesi-sesi sebelumnya
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:experience-agent` subagent untuk menampilkan dan menelusuri experience journal — kumpulan catatan pembelajaran, pola kegagalan, dan insight dari seluruh sesi pengembangan sebelumnya.

Command ini berguna ketika Anda ingin:
- Melihat lessons learned dari sesi debugging atau implementasi sebelumnya
- Mengecek pola kegagalan yang sudah tercatat sebelum memulai task baru
- Meninjau keputusan arsitektur dan alasannya yang terdokumentasi di journal
- Mendapatkan konteks dari sesi sebelumnya agar tidak mengulangi kesalahan yang sama

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it.
> - New tools: `mcp__codegraph__update_codebase`, `mcp__codegraph__diff_graphs`.
