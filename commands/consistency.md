---
description: Consistency Enforcer — validasi konsistensi kode terhadap project pattern
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:consistency-enforcer` subagent untuk memvalidasi dan menegakkan konsistensi kode terhadap pola dominan codebase.

Gunakan command ini ketika:
- Memeriksa konsistensi penamaan file/folder/variabel/fungsi/kelas
- Memastikan kode baru mengikuti standar codebase yang sudah ada
- Sebelum merge PR untuk quality gate
- Setelah refactor besar untuk memverifikasi keseragaman
- Menemukan pola campuran (mixed conventions) yang perlu diselaraskan

Jika argumen scope opsional diberikan, batasi pemeriksaan pada scope tertentu (direktori, modul, atau pola file). Tanpa argumen, agent akan memindai seluruh codebase.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it.
> - New tools: `mcp__codegraph__update_codebase`, `mcp__codegraph__diff_graphs`.
