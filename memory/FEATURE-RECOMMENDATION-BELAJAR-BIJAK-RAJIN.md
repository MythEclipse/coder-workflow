# Analisis Workflow AI & Rekomendasi Fitur

> **Tujuan:** Membuat AI agent di coder-workflow plugin bisa **BELAJAR** dari pengalaman, **BIJAK** dalam mengambil keputusan, dan **RAJIN** dalam menjaga kualitas.

---

## 📊 Ringkasan Existing State

### Yang SUDAH ADA (tapi belum optimal):

| Area | Existing | Gap |
|------|----------|-----|
| **Memory** | Cross-Agent Memory, `.coder-memory/`, memory-librarian agent | Hanya menyimpan, jarang dikonsultasi otomatis |
| **Learning** | Headroom Learn (failure logging, correction matching) | Hanya failure, tidak belajar dari success/user preference |
| **Session** | Session metrics, hooks lifecycle | Tidak ada cross-session knowledge carryover otomatis |
| **Quality** | Impact Radius, todo-checker, code-reviewer | Tidak ada proactive guardian yg cegah masalah sebelum terjadi |
| **Decision** | ADR system | Terlalu formal untuk daily micro-decisions |
| **Wisdom** | Orchestrator routing, workflow planner | Tidak ada "risk assessment" sebelum task execution |
| **Rajin** | PreToolUse/PostToolUse hooks, Stop hooks | Reaktif — belum ada automated pre-flight checks |

---

## 🧠 PILLAR 1: BELAJAR (Learning System)

### 1.1 Experience Journal — "Project Wisdom Archive"

**Masalah:** Setiap session mulai dari nol. Pelajaran berharga dari sesi sebelumnya hilang.

**Solusi:** Agent baru **`experience-journal`** yang secara otomatis:
- **Post-Task Reflection:** Setelah setiap task selesai → catat:
  - What worked? What didn't?
  - Root cause analysis of bugs found
  - Architectural decisions & rationale
  - Pattern yang berhasil / anti-pattern yang gagal
- **Auto-Postmortem on Failure:** Ketika task gagal 3x → auto-generate postmortem + store ke memory
- **Wisdom Retrieval:** Sebelum task dimulai → cari relevant past lessons dari project yang sama

**Implementation:**
```
agents/experience-journal.md
commands/experience.md → /experience
hooks/ → PostTaskReflection hook (auto-trigger)
```

### 1.2 Success Pattern Recognition — "What Works"

**Masalah:** Headroom Learn hanya melacak *failures*. Tidak ada sistem yang mencatat *apa yang berhasil*.

**Solusi:** Enhance `learn.ts` + hooks untuk:
- Track successful test passes (what pattern made tests pass?)
- Track user-accepted suggestions (user accepted refactor X → tandai sebagai preferensi)
- Track clean builds (what config worked?)
- Build "success signature database": `{ task_type, approach, outcome: "success" }`

**Key enhancement:**
```typescript
// Di learn.ts, tambah:
export interface SuccessRecord {
  taskType: string;
  approach: string;
  pattern: string;
  outcome: "success" | "fast_pass";
  context: string;
  reusable: boolean;
}
```

### 1.3 Cross-Session Memory Consolidation

**Masalah:** Memory di `.coder-memory/` dan `.claude/cross-agent-memory/` hanya diisi manual.

**Solusi:** Saat `SessionEnd` hook fires (sudah ada!), auto-ekstrak:
- Keputusan arsitektur → `decision-{date}.md`
- Pelajaran debugging → `lesson-{bug-pattern}.md`
- Preferensi user → `preference-{topic}.md`
- Perubahan penting API → `reference-{module}-{date}.md`

**Hook enhancement:** Tambah `PostSessionEnd` consolidation logic di `session-metrics.sh` atau agent baru.

### 1.4 User Preference Learning Profile

**Masalah:** User punya preferensi style/naming/architecture tapi harus di-repeat di prompt.

**Solusi:** Bangun preferensi profile yang auto-terbentuk:
- Dari `CLAUDE.md` → parse explicit preferences
- Dari user edits → infer pattern (user always renames X to Y → pelajari)
- Dari code review feedback → catat preferensi reviewer

**Format profil:**
```json
{
  "naming": { "controllers": "Controller", "services": "Service" },
  "architecture": "modular-mvc",
  "validation": "zod",
  "testStyle": "unit-first",
  "preferredLibs": ["prisma", "fastify"],
  "dislikedPatterns": ["any types", "magic strings"]
}
```

---

## 🎯 PILLAR 2: BIJAK (Wisdom Layer)

### 2.1 Risk-Aware Task Execution

**Masalah:** Agent langsung execute tanpa tahu resiko — sering menabrak masalah yang sama.

**Solusi:** Sebelum task execution, lakukan **Risk Assessment Query**:
1. **Apakah ada past failures di area ini?** → cek `.claude/learn/failures.jsonl`
2. **Apakah ada similar task sebelumnya?** → cek cross-agent memory
3. **Apa impact radius-nya?** → sudah ada via Impact Radius Protocol
4. **Apa recommended approach?** → dari experience journal

**Hook integration:** Tambah ke `PreToolUse` untuk `Write/Edit` — sebelum edit, cek risiko.

### 2.2 Lite-ADR — "Micro Decision Log"

**Masalah:** ADR terlalu formal untuk keputusan kecil sehari-hari.

**Solusi:** Fitur **Lite-ADR** / **Decision Snapshots**:
- Setiap kali agent memilih antara beberapa approach → catat sebagai decision snapshot
- Format minimal: `{ context, options, selected, rationale, timestamp }`
- Auto-dipanggil saat `sequential_thinking` MCP digunakan
- Bisa di-query: "Kenapa dulu pilih X daripada Y?"

**CLI command:**
```bash
coder-workflow decision list
coder-workflow decision show <id>
coder-workflow decision why "chose prisma over typeorm"
```

### 2.3 Trade-off Analysis Engine

**Masalah:** Agent sering memilih solusi tanpa mempertimbangkan trade-offs secara eksplisit.

**Solusi:** Agent **trade-off-analyzer** yang:
- Saat menerima task → generate 2-3 approach dengan trade-off matrix
- Pertimbangkan: complexity, maintainability, performance, security, learning curve
- Rekomendasikan berdasarkan project profile (preferences dari Pillar 1.4)
- Store decision + trade-off ke experience journal

**Trade-off Matrix output:**
```
## Approach Comparison: [Feature X]
| Criteria | Approach A (Prisma) | Approach B (Raw SQL) |
|----------|-------------------|---------------------|
| Complexity | Low | High |
| Performance | Medium | High |
| Type Safety | High | Low |
| Migration | Built-in | Manual |
| Team Familiarity | High | Low |

**Recommended:** Approach A (matches project pattern)
```

### 2.4 Knowledge Integration Hub

**Masalah:** Agent perlu tahu best practices dari luar kodebase (docs, library updates).

**Solusi:** Agent **knowledge-integrator** yang:
- Gunakan Context7 MCP secara proaktif untuk cek docs/library updates
- Integrasikan external knowledge dengan project patterns
- Beri "Did you know?" tips berbasis task context
- Maintain "library knowledge base" per project

---

## ⚡ PILLAR 3: RAJIN (Diligence Automation)

### 3.1 Pre-Flight Checklist — "Auto Readiness Check"

**Masalah:** Agent langsung kerja tanpa cek kondisi proyek.

**Solusi:** Sebelum task dimulai, auto-run checklist:

```
☐ Codebase typecheck: [PASS/FAIL]
☐ Lint status: [PASS/FAIL]
☐ Test status: [PASS/FAIL]
☐ Graph freshness: [OK/STALE]
☐ Past failures in area: [NONE/FOUND]
☐ Open deferred bugs: [NONE/N]
☐ Relevant memory entries: [NONE/FOUND]
```

**Implementation:** Hook `PreToolUse` untuk `Agent` — sebelum spawn subagent, run checklist.

### 3.2 Proactive Quality Guardian Agent

**Masalah:** Quality check terjadi *setelah* kode ditulis, bukan *sebelum*.

**Solusi:** Agent **`quality-guardian`** yang:
- **Before write:** Cek apakah file punya pre-existing issues (type/lint/test)
- **During write:** Monitor diff dan cegah regression
- **After write:** Run targeted verification, compare before/after quality score
- **Always:** Maintain quality trend chart per module

**Quality Score formula:**
```
Quality Score = (typecheck_before - typecheck_after) + 
                (lint_warnings_before - lint_warnings_after) + 
                (test_pass_rate_before - test_pass_rate_after)
Nilai negatif = regression → BLOCK.
```

### 3.3 Automated Tech Debt Tracker

**Masalah:** Tech debt menumpuk tanpa ada yang monitor secara sistematis.

**Solusi:** Enhance `todo-checker` agent menjadi **debt-tracker**:
- Klasifikasi TODOs: `TYPE:bug|enhancement|refactor|documentation` + `SEVERITY:critical|major|minor`
- Track age of each TODO (auto-aging)
- Generate tech debt dashboard per sprint
- **NEW:** Debt budget enforcement — jika debt > threshold (e.g., 20 TODOs), blokir feature addition baru

**Tech debt report:**
```
## Tech Debt Report — Module: user-service
| Todo | Age | Type | Severity | 
|------|-----|------|----------|
| Fix input validation | 45d | bug | CRITICAL |
| Add error handling | 30d | enhancement | MAJOR |
| Refactor helper | 10d | refactor | MINOR |

Total Debt: 3 items (1 CRITICAL, 1 MAJOR, 1 MINOR)
Debt Score: 27/100 ⚠️ (blocked: threshold 25 exceeded)
```

### 3.4 Consistency Enforcement Agent

**Masalah:** Developer (manusia atau AI) sering inconsist dalam naming, struktur, pattern.

**Solusi:** Agent **`consistency-enforcer`** yang:
- Define "project pattern profile" dari existing code
- Validate new code against profile
- Flag inconsistencies: "This controller uses `findAll()` but the project convention is `list()`"
- Auto-suggest fixes based on dominant pattern

**Pattern profile auto-detect:**
```typescript
// Dari scan kode existing, deteksi:
{
  namingConventions: {
    controllers: "PascalCase + Controller",
    services: "PascalCase + Service",
    files: "kebab-case"
  },
  importStyle: "named exports preferred",
  errorHandling: "custom Error classes + middleware",
  fileOrganization: "feature-first"
}
```

### 3.5 Proactive Bug Hunter

**Masalah:** Bug ditemukan di review/test, padahal bisa dicegah lebih awal.

**Solusi:** Agent **`bug-hunter`** yang jalan *bersamaan* dengan implementasi:
- Scan setiap diff untuk common bug patterns
- Null check: semua nullable sudah di-handle?
- Error handling: semua Promise ada .catch()?
- Boundary: array access, negative numbers, empty states?
- Security: SQL injection, XSS, auth bypass patterns

**Integration:** Jalankan sebagai parallel subagent saat implementasi.

### 3.6 Ceklis Kualitas Otomatis Saat Stop

**Masalah:** Sekarang `Stop` hook cuma auto-commit dan update graph.

**Solusi:** Enhance `Stop` hook untuk:
1. **Quality Gate:** Jalankan typecheck + lint + test pada file yang diubah
2. **Debt Check:** Cek apakah ada TODO/FIXME baru yang ditambahkan
3. **Regression Check:** Bandingkan dengan sebelum perubahan (dari git stash)
4. **Memory Check:** Apakah ada keputusan penting yang belum di-catat?
5. **Health Report:** Output ringkasan kualitas

---

## 🔄 Recommended Implementation Priority

### Week 1-2: Foundations (RAJIN)
1. **Pre-Flight Checklist** (3.1) — hooks enhancement, paling cepat impact
2. **Quality Guardian Agent** (3.2) — agent definition + basic hooks
3. **Consistency Enforcer** (3.4) — pattern detection

### Week 3-4: Memory & Learning (BELAJAR)
4. **Experience Journal Agent** (1.1) — new agent + post-task hook
5. **Cross-Session Consolidation** (1.3) — SessionEnd enhancement
6. **Success Pattern Recognition** (1.2) — learn.ts enhancement

### Week 5-6: Wisdom Layer (BIJAK)
7. **Risk-Aware Execution** (2.1) — pre-task assessment
8. **Lite-ADR System** (2.2) — decision snapshots
9. **Trade-off Analysis** (2.3) — agent definition
10. **User Preference Profile** (1.4) — profiling system

### Week 7-8: Advanced + Polish
11. **Proactive Bug Hunter** (3.5) — parallel scanning
12. **Automated Post-mortem** (2.4)
13. **Stop Quality Gate** (3.6) — enhanced hook
14. **Tech Debt Tracker** (3.3) — dashboard + budget enforcement

---

## 📈 Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| **Bug escape rate** | High (bugs found in review/test) | Low (caught before write) |
| **Context switch cost** | High (tiap session start from zero) | Low (memory recall otomatis) |
| **Decision consistency** | Varies per task | Terstandar dengan trade-off docs |
| **Code consistency** | Inconsistent patterns | Project profile enforcement |
| **Tech debt awareness** | None | Tracked + budgeted |
| **Learning velocity** | Setiap session ulang | Knowledge accumulation |
| **Rajin (diligence)** | Reactif (masalah dulu baru cek) | Proaktif (cegah sebelum terjadi) |

---

## 🏗️ Implementation Pattern

Untuk setiap fitur baru, ikuti pola plugin yang sudah ada:

```
agents/<feature-name>.md        → Agent definition (frontmatter + system prompt)
commands/<feature-name>.md      → Slash command mapping
src/<feature>.ts                → Implementation logic
hooks/hooks.json                → Hook integration (auto-trigger)
```

### Shared Anti-Lazy Directive
Semua agent baru harus inherit `_shared/OVERPOWERED.md` directive:
1. **Absolute Anti-Reductionism** — jangan oversimplify
2. **Over-Engineering Mandate** — prefer robust solution
3. **Zero Suppression** — fix root cause, jangan supresi
4. **No Dummy Code** — semua solusi real, bukan placeholder
5. **Strict Anti-Speculation** — jangan halusinasi

---

## 📋 Summary: 3 Pillars, 14 Features

| Pillar | Fitur | Tipe | Impact |
|--------|-------|------|--------|
| 🧠 **BELAJAR** | Experience Journal | New Agent | High |
| 🧠 **BELAJAR** | Success Pattern Recognition | Enhancement | Medium |
| 🧠 **BELAJAR** | Cross-Session Consolidation | Hook Enhancement | High |
| 🧠 **BELAJAR** | User Preference Profile | New System | Medium |
| 🎯 **BIJAK** | Risk-Aware Execution | Hook Enhancement | High |
| 🎯 **BIJAK** | Lite-ADR System | New CLI + Agent | Medium |
| 🎯 **BIJAK** | Trade-off Analysis | New Agent | Medium |
| 🎯 **BIJAK** | Knowledge Integration | Agent + Context7 | Medium |
| ⚡ **RAJIN** | Pre-Flight Checklist | Hook Enhancement | High |
| ⚡ **RAJIN** | Quality Guardian | New Agent | High |
| ⚡ **RAJIN** | Tech Debt Tracker | Enhancement | Medium |
| ⚡ **RAJIN** | Consistency Enforcer | New Agent | Medium |
| ⚡ **RAJIN** | Proactive Bug Hunter | Parallel Agent | High |
| ⚡ **RAJIN** | Stop Quality Gate | Hook Enhancement | High |

---

> **Kesimpulan:** Plugin coder-workflow sudah punya fondasi kuat (hooks, agents, memory, orchestrator). Yang kurang adalah **learning loop** (experience → memory → wisdom), **proactive quality**, dan **decision intelligence**. Dengan 14 fitur ini, AI agent tidak akan bekerja seperti fresh graduate setiap kali, tapi seperti senior engineer yang belajar dari setiap pengalaman.
