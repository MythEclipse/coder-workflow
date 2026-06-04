import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface LanguageStats {
  name: string;
  files: number;
  lines: number;
  bytes: number;
  percent: number;
}

export interface DepInfo {
  name: string;
  version: string;
  type: "dependencies" | "devDependencies" | "peerDependencies";
}

export interface CodebaseStats {
  totalFiles: number;
  totalLines: number;
  totalBytes: number;
  languages: LanguageStats[];
  dependencies: DepInfo[];
  devDependencies: DepInfo[];
  generatedAt: string;
}

export interface StatsHistory {
  reports: CodebaseStats[];
  dates: string[];
  trends: {
    lines: Array<{ date: string; value: number }>;
    files: Array<{ date: string; value: number }>;
    deps: Array<{ date: string; value: number }>;
  };
}

// ---------------------------------------------------------------------------
// Extension → Language Mapping
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".md": "Markdown",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "SCSS",
  ".html": "HTML",
  ".sql": "SQL",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".dart": "Dart",
  ".lua": "Lua",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
};

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".claude",
  ".coder-workflow",
  "coverage",
]);

// ---------------------------------------------------------------------------
// countLinesInFile
// ---------------------------------------------------------------------------

export function countLinesInFile(filePath: string): { lines: number; bytes: number } {
  try {
    const content = readFileSync(filePath);
    const bytes = content.length;
    const text = content.toString("utf-8");
    const newlines = text.split("\n").length;
    // If the file is empty (0 bytes), lines is 0
    const lines = bytes === 0 ? 0 : newlines;
    return { lines, bytes };
  } catch {
    return { lines: 0, bytes: 0 };
  }
}

// ---------------------------------------------------------------------------
// analyzeLanguages
// ---------------------------------------------------------------------------

export function analyzeLanguages(root: string, options?: { exclude?: string[] }): LanguageStats[] {
  const rootPath = resolve(root);
  const languageMap = new Map<string, { files: number; lines: number; bytes: number }>();

  const skipDirs = new Set(DEFAULT_SKIP_DIRS);
  if (options?.exclude) {
    for (const ex of options.exclude) {
      skipDirs.add(ex);
    }
  }

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      if (entry.startsWith(".") && entry !== ".env.example") continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = entry.substring(entry.lastIndexOf(".")).toLowerCase();
        const langName = EXTENSION_MAP[ext];
        if (!langName) continue;

        const { lines, bytes } = countLinesInFile(fullPath);
        const current = languageMap.get(langName) || {
          files: 0,
          lines: 0,
          bytes: 0,
        };
        current.files += 1;
        current.lines += lines;
        current.bytes += bytes;
        languageMap.set(langName, current);
      }
    }
  }

  walk(rootPath);

  const totalLines = Array.from(languageMap.values()).reduce((sum, v) => sum + v.lines, 0);

  const result: LanguageStats[] = Array.from(languageMap.entries())
    .map(([name, data]) => ({
      name,
      files: data.files,
      lines: data.lines,
      bytes: data.bytes,
      percent: totalLines > 0 ? Math.round((data.lines / totalLines) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.lines - a.lines);

  return result;
}

// ---------------------------------------------------------------------------
// collectDependencies
// ---------------------------------------------------------------------------

export function collectDependencies(
  root: string,
  manifest?: string,
): { dependencies: DepInfo[]; devDependencies: DepInfo[] } {
  const rootPath = resolve(root);
  const manifestPath = manifest || join(rootPath, "package.json");

  const deps: DepInfo[] = [];
  const devDeps: DepInfo[] = [];

  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    const rawDeps = pkg.dependencies as Record<string, string> | undefined;
    const rawDevDeps = pkg.devDependencies as Record<string, string> | undefined;
    const rawPeerDeps = pkg.peerDependencies as Record<string, string> | undefined;

    if (rawDeps) {
      for (const [name, version] of Object.entries(rawDeps)) {
        deps.push({ name, version, type: "dependencies" });
      }
    }

    if (rawDevDeps) {
      for (const [name, version] of Object.entries(rawDevDeps)) {
        devDeps.push({ name, version, type: "devDependencies" });
      }
    }

    if (rawPeerDeps) {
      for (const [name, version] of Object.entries(rawPeerDeps)) {
        deps.push({ name, version, type: "peerDependencies" });
      }
    }
  } catch {
    // file not found or invalid JSON
  }

  return { dependencies: deps, devDependencies: devDeps };
}

// ---------------------------------------------------------------------------
// generateStats
// ---------------------------------------------------------------------------

export function generateStats(root: string, options?: { exclude?: string[] }): CodebaseStats {
  const rootPath = resolve(root);
  const languages = analyzeLanguages(rootPath, options);
  const depResult = collectDependencies(rootPath);

  const totalFiles = languages.reduce((sum, l) => sum + l.files, 0);
  const totalLines = languages.reduce((sum, l) => sum + l.lines, 0);
  const totalBytes = languages.reduce((sum, l) => sum + l.bytes, 0);

  return {
    totalFiles,
    totalLines,
    totalBytes,
    languages,
    dependencies: depResult.dependencies,
    devDependencies: depResult.devDependencies,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getStatsHistory
// ---------------------------------------------------------------------------

export function getStatsHistory(root: string): StatsHistory {
  const rootPath = resolve(root);
  const historyPath = join(rootPath, ".claude", "stats-history.jsonl");

  const reports: CodebaseStats[] = [];
  const dates: string[] = [];

  try {
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { date: string; stats: CodebaseStats };
        dates.push(parsed.date);
        reports.push(parsed.stats);
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // no history file yet
  }

  const trends = {
    lines: reports.map((r, i) => ({
      date: dates[i] || r.generatedAt,
      value: r.totalLines,
    })),
    files: reports.map((r, i) => ({
      date: dates[i] || r.generatedAt,
      value: r.totalFiles,
    })),
    deps: reports.map((r, i) => ({
      date: dates[i] || r.generatedAt,
      value: r.dependencies.length + r.devDependencies.length,
    })),
  };

  return { reports, dates, trends };
}

// ---------------------------------------------------------------------------
// recordStats
// ---------------------------------------------------------------------------

export function recordStats(root: string): CodebaseStats {
  const rootPath = resolve(root);
  const stats = generateStats(rootPath);
  const historyDir = join(rootPath, ".claude");

  if (!existsSync(historyDir)) {
    try {
      writeFileSync(join(historyDir, ".gitkeep"), "", "utf-8");
    } catch {
      // ignore
    }
  }

  const historyPath = join(historyDir, "stats-history.jsonl");
  const entry = JSON.stringify({ date: new Date().toISOString(), stats }) + "\n";

  try {
    writeFileSync(historyPath, entry, { flag: "a", encoding: "utf-8" });
  } catch {
    // unable to write history
  }

  return stats;
}

// ---------------------------------------------------------------------------
// compareStats
// ---------------------------------------------------------------------------

export function compareStats(
  before: CodebaseStats,
  after: CodebaseStats,
): {
  linesDiff: number;
  filesDiff: number;
  depsAdded: string[];
  depsRemoved: string[];
  languageChanges: Array<{ name: string; before: number; after: number; change: number }>;
} {
  const linesDiff = after.totalLines - before.totalLines;
  const filesDiff = after.totalFiles - before.totalFiles;

  const beforeDepNames = new Set([
    ...before.dependencies.map((d) => d.name),
    ...before.devDependencies.map((d) => d.name),
  ]);
  const afterDepNames = new Set([
    ...after.dependencies.map((d) => d.name),
    ...after.devDependencies.map((d) => d.name),
  ]);

  const depsAdded: string[] = [];
  const depsRemoved: string[] = [];

  for (const name of afterDepNames) {
    if (!beforeDepNames.has(name)) {
      depsAdded.push(name);
    }
  }
  for (const name of beforeDepNames) {
    if (!afterDepNames.has(name)) {
      depsRemoved.push(name);
    }
  }

  const beforeLangMap = new Map<string, number>();
  for (const lang of before.languages) {
    beforeLangMap.set(lang.name, lang.lines);
  }

  const languageChanges: Array<{
    name: string;
    before: number;
    after: number;
    change: number;
  }> = [];

  const allLangNames = new Set([
    ...before.languages.map((l) => l.name),
    ...after.languages.map((l) => l.name),
  ]);

  for (const name of allLangNames) {
    const beforeVal = beforeLangMap.get(name) || 0;
    const afterLang = after.languages.find((l) => l.name === name);
    const afterVal = afterLang ? afterLang.lines : 0;
    const change = afterVal - beforeVal;
    if (change !== 0) {
      languageChanges.push({ name, before: beforeVal, after: afterVal, change });
    }
  }

  languageChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return { linesDiff, filesDiff, depsAdded, depsRemoved, languageChanges };
}

// ---------------------------------------------------------------------------
// formatStats
// ---------------------------------------------------------------------------

export function formatStats(stats: CodebaseStats): string {
  const lines: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n);

  lines.push("");
  lines.push("Codebase Statistics");
  lines.push("=".repeat(60));
  lines.push(`  Generated: ${stats.generatedAt}`);
  lines.push("");
  lines.push(`  Total Files:  ${stats.totalFiles}`);
  lines.push(`  Total Lines:  ${stats.totalLines}`);
  lines.push(`  Total Bytes:  ${formatBytes(stats.totalBytes)}`);
  lines.push(`  Languages:    ${stats.languages.length}`);
  lines.push(`  Dependencies: ${stats.dependencies.length}`);
  lines.push(`  Dev Deps:     ${stats.devDependencies.length}`);
  lines.push("");

  // Language breakdown with bars
  if (stats.languages.length > 0) {
    const maxPercent = Math.max(...stats.languages.map((l) => l.percent));
    const barWidth = 20;

    lines.push("Language Breakdown:");
    lines.push("-".repeat(60));

    const header = `${pad("Language", 16)} ${pad("Files", 7)} ${pad("Lines", 10)} ${pad("Size", 9)} ${pad("%", 6)} Bar`;
    lines.push(header);
    lines.push("-".repeat(header.length));

    for (const lang of stats.languages) {
      const barLen =
        maxPercent > 0 ? Math.max(1, Math.round((lang.percent / maxPercent) * barWidth)) : 1;
      const bar = "█".repeat(barLen);
      const pct = lang.percent.toFixed(1);

      // Show trailing dots for color indication
      const remaining = barWidth - barLen;
      const trail = remaining > 0 ? "░".repeat(remaining) : "";

      lines.push(
        `${pad(lang.name, 16)} ${pad(String(lang.files), 7)} ${pad(String(lang.lines), 10)} ${pad(formatBytes(lang.bytes), 9)} ${pad(pct, 6)} ${bar}${trail}`,
      );
    }
    lines.push("");
  }

  // Dependency summary
  if (stats.dependencies.length > 0) {
    lines.push(`Top Dependencies (${stats.dependencies.length} total):`);
    const sorted = [...stats.dependencies].sort((a, b) => a.name.localeCompare(b.name));
    for (const dep of sorted.slice(0, 15)) {
      const typeTag = dep.type === "peerDependencies" ? " (peer)" : "";
      lines.push(`  • ${dep.name}@${dep.version}${typeTag}`);
    }
    if (sorted.length > 15) {
      lines.push(`  ... and ${sorted.length - 15} more`);
    }
    lines.push("");
  }

  if (stats.devDependencies.length > 0) {
    lines.push(`Top Dev Dependencies (${stats.devDependencies.length} total):`);
    const sorted = [...stats.devDependencies].sort((a, b) => a.name.localeCompare(b.name));
    for (const dep of sorted.slice(0, 10)) {
      lines.push(`  • ${dep.name}@${dep.version}`);
    }
    if (sorted.length > 10) {
      lines.push(`  ... and ${sorted.length - 10} more`);
    }
    lines.push("");
  }

  lines.push("=".repeat(60));
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatStatsHistory
// ---------------------------------------------------------------------------

export function formatStatsHistory(history: StatsHistory): string {
  const lines: string[] = [];

  if (history.reports.length === 0) {
    return "\n  No stats history found.\n";
  }

  lines.push("");
  lines.push("Stats History");
  lines.push("=".repeat(60));
  lines.push(`  Snapshots: ${history.reports.length}`);
  lines.push(
    `  Span:      ${history.dates[0] || "?"} → ${history.dates[history.dates.length - 1] || "?"}`,
  );
  lines.push("");

  // Trend indicators
  const latest = history.reports[history.reports.length - 1];
  const first = history.reports[0];

  const linesDelta = latest.totalLines - first.totalLines;
  const filesDelta = latest.totalFiles - first.totalFiles;
  const depsDelta =
    latest.dependencies.length +
    latest.devDependencies.length -
    first.dependencies.length -
    first.devDependencies.length;

  const deltaStr = (delta: number): string => {
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return `${delta}`;
    return "0";
  };

  lines.push("Trends (overall change):");
  lines.push(`  Lines: ${first.totalLines} → ${latest.totalLines} (${deltaStr(linesDelta)})`);
  lines.push(`  Files: ${first.totalFiles} → ${latest.totalFiles} (${deltaStr(filesDelta)})`);
  lines.push(
    `  Deps:  ${first.dependencies.length + first.devDependencies.length} → ${latest.dependencies.length + latest.devDependencies.length} (${deltaStr(depsDelta)})`,
  );
  lines.push("");

  // Per-snapshot breakdown
  lines.push("Snapshot History:");
  lines.push("-".repeat(60));
  const header = `${"#".padEnd(4)} ${"Date".padEnd(28)} ${"Files".padEnd(8)} ${"Lines".padEnd(10)} ${"Deps".padEnd(6)}`;
  lines.push(header);
  lines.push("-".repeat(header.length));

  for (let i = 0; i < history.reports.length; i++) {
    const r = history.reports[i];
    const date = (history.dates[i] || r.generatedAt).slice(0, 24);
    const depCount = r.dependencies.length + r.devDependencies.length;

    // Compare with previous for +/- indicators
    let filesMarker = "";
    let linesMarker = "";
    let depsMarker = "";

    if (i > 0) {
      const prev = history.reports[i - 1];
      const fDiff = r.totalFiles - prev.totalFiles;
      const lDiff = r.totalLines - prev.totalLines;
      const dDiff =
        r.dependencies.length +
        r.devDependencies.length -
        prev.dependencies.length -
        prev.devDependencies.length;

      filesMarker = fDiff !== 0 ? ` ${fDiff > 0 ? "+" : ""}${fDiff}` : "";
      linesMarker = lDiff !== 0 ? ` ${lDiff > 0 ? "+" : ""}${lDiff}` : "";
      depsMarker = dDiff !== 0 ? ` ${dDiff > 0 ? "+" : ""}${dDiff}` : "";
    }

    lines.push(
      `${String(i + 1).padEnd(4)} ${date.padEnd(28)} ${String(r.totalFiles).padEnd(8)}${filesMarker.padEnd(6)} ${String(r.totalLines).padEnd(10)}${linesMarker.padEnd(8)} ${String(depCount).padEnd(6)}${depsMarker}`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / 1024 ** i;
  return `${val.toFixed(1)} ${units[i]}`;
}
