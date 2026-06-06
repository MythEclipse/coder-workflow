---
description: Trade-off Analysis — bandingkan approach, lihat keputusan masa lalu
argument-hint: [optional-scope]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Invoke the `coder-workflow:tradeoff-agent` subagent untuk melakukan trade-off analysis terhadap scope yang diberikan.

Gunakan command ini ketika:
- Membandingkan dua atau lebih pendekatan arsitektur (misal: microservices vs monolith, SQL vs NoSQL, REST vs GraphQL)
- Mengevaluasi keputusan teknis yang memiliki konsekuensi jangka panjang
- Menganalisis trade-off antara performance, maintainability, scalability, dan development speed
- Mereview keputusan masa lalu yang tercatat di ADR untuk memahami konteks dan alasan di baliknya
- Membantu tim mencapai consensus dengan menyajikan data objektif

Jika scope argument diberikan (seperti path module atau nama fitur), agent akan memfokuskan analisis pada area tersebut. Jika tidak ada argument, agent akan mengidentifikasi area-area dalam codebase yang membutuhkan evaluasi trade-off dan menanyakannya ke user.

> [!IMPORTANT]
> MCP TOOL UPDATES:
> - `mcp__codegraph__read_file` has been PERMANENTLY DELETED. Do NOT try to use it. Use standard `Read` or delegate file reading to explorer subagents.
> - `mcp__codegraph__analyze_impact` and `list_directory_tree` now have UNLIMITED depth.
> - New tools available: `mcp__codegraph__update_codebase` (partial scan) and `mcp__codegraph__diff_graphs` (compare structural states before/after changes).
> - Use `mcp__codegraph__query_graph` to find related symbols, modules, and dependency relationships relevant to the trade-off.
> - Use `mcp__codegraph__adr_list` and `mcp__codegraph__adr_get` to inspect past architecture decisions that may inform the current trade-off.
