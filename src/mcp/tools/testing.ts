import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import type { McpTool } from "./types.js";

export interface ToolEntry {
  name: string;
  tool: McpTool;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function walkFiles(root: string): string[] {
  const result: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) walk(full);
        else if (s.isFile()) result.push(full);
      } catch {
        continue;
      }
    }
  }
  walk(root);
  return result;
}

function tryReadFile(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

// ─── 1. test-coverage-reporter ────────────────────────────────────────────────

export const testCoverageReporter: ToolEntry = {
  name: "test-coverage-reporter",
  tool: {
    description:
      "Check for coverage reports (coverage/lcov.info, coverage/coverage-final.json) and report coverage summary.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: async (_args: Record<string, unknown>, root: string): Promise<unknown> => {
      const base = resolve(root);
      const candidates = [
        join(base, "coverage", "lcov.info"),
        join(base, "coverage", "coverage-final.json"),
        join(base, "coverage", "clover.xml"),
        join(base, "coverage", "cobertura-coverage.xml"),
      ];

      for (const file of candidates) {
        const content = tryReadFile(file);
        if (content === null) continue;

        const ext = extname(file);

        // lcov.info parser
        if (ext === ".info" || basename(file) === "lcov.info") {
          const files: { file: string; covered: number; total: number; pct: number }[] = [];
          let currentFile = "";
          let found = 0;
          let hit = 0;

          for (const line of content.split("\n")) {
            if (line.startsWith("SF:")) {
              if (currentFile && found > 0) {
                files.push({
                  file: currentFile,
                  covered: hit,
                  total: found,
                  pct: found > 0 ? Math.round((hit / found) * 10000) / 100 : 0,
                });
              }
              currentFile = line.slice(3).trim();
              found = 0;
              hit = 0;
            } else if (line.startsWith("DA:")) {
              const [, countStr] = line.slice(3).split(",");
              const count = Number.parseInt(countStr, 10);
              found += 1;
              if (count > 0) hit += 1;
            }
          }
          if (currentFile && found > 0) {
            files.push({
              file: currentFile,
              covered: hit,
              total: found,
              pct: found > 0 ? Math.round((hit / found) * 10000) / 100 : 0,
            });
          }

          const totalCovered = files.reduce((s, l) => s + l.covered, 0);
          const totalTotal = files.reduce((s, l) => s + l.total, 0);
          const overallPct =
            totalTotal > 0 ? Math.round((totalCovered / totalTotal) * 10000) / 100 : 0;

          return {
            hasCoverageReport: true,
            format: "lcov",
            files: files.filter((l) => l.total > 0).slice(0, 200),
            summary: { covered: totalCovered, total: totalTotal, pct: overallPct },
          };
        }

        // JSON coverage report (coverage-final.json / Istanbul format)
        if (ext === ".json") {
          try {
            const parsed = JSON.parse(content) as Record<
              string,
              { s: Record<string, number> }
            >;
            const files: { file: string; covered: number; total: number; pct: number }[] = [];

            for (const [filePath, data] of Object.entries(parsed)) {
              const statements = data.s ?? {};
              const total = Object.keys(statements).length;
              const covered = Object.values(statements).filter((v) => v > 0).length;
              files.push({
                file: filePath,
                covered,
                total,
                pct: total > 0 ? Math.round((covered / total) * 10000) / 100 : 0,
              });
            }

            const totalCovered = files.reduce((s, l) => s + l.covered, 0);
            const totalTotal = files.reduce((s, l) => s + l.total, 0);
            const overallPct =
              totalTotal > 0 ? Math.round((totalCovered / totalTotal) * 10000) / 100 : 0;

            return {
              hasCoverageReport: true,
              format: "istanbul-json",
              files: files.filter((l) => l.total > 0).slice(0, 200),
              summary: { covered: totalCovered, total: totalTotal, pct: overallPct },
            };
          } catch {
            continue;
          }
        }

        // XML (Cobertura / Clover) — rough line-count parser
        if (ext === ".xml") {
          const lineRateMatch = content.match(/line-rate="([\d.]+)"/);
          const lineRate = lineRateMatch ? Number.parseFloat(lineRateMatch[1]) : null;
          return {
            hasCoverageReport: true,
            format: basename(file).includes("clover") ? "clover" : "cobertura",
            files: [],
            summary: lineRate !== null ? { pct: Math.round(lineRate * 10000) / 100 } : null,
          };
        }
      }

      return {
        hasCoverageReport: false,
        message: "No coverage report found in coverage/ directory.",
      };
    },
  },
};

// ─── 2. flaky-test-historian ──────────────────────────────────────────────────

export const flakyTestHistorian: ToolEntry = {
  name: "flaky-test-historian",
  tool: {
    description:
      "Scan test output logs and CI artifacts for retry patterns (RERUN, retry, flaky).",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to scan for test logs (default: root/test-results or root)",
        },
      },
      required: [],
    },
    handler: async (args: Record<string, unknown>, root: string): Promise<unknown> => {
      const base = resolve(root);
      const dir = args.directory ? resolve(base, String(args.directory)) : base;

      const logDirs = [join(dir, "test-results"), join(dir, "test-output"), dir];
      const retryPatterns = [
        /RERUN/i,
        /retry/i,
        /flaky/i,
        /FAIL.*retry/,
        /retry.*FAIL/,
        /attempt \d+ of \d+/i,
        /pass after retry/i,
        /failed, will retry/i,
      ];

      const testMap = new Map<string, number>();
      const seenLines = new Set<string>();

      for (const logDir of logDirs) {
        if (!existsSync(logDir)) continue;
        const files = walkFiles(logDir);
        for (const file of files) {
          const ext = extname(file).toLowerCase();
          if (![".log", ".txt", ".json", ".xml"].includes(ext)) continue;
          const content = tryReadFile(file);
          if (!content) continue;
          const fileName = basename(file);

          for (const line of content.split("\n")) {
            for (const pattern of retryPatterns) {
              if (pattern.test(line)) {
                const testMatch = line.match(
                  /(?:✓|✗|FAIL|PASS|×|•)\s*[→>]\s*([^(]+)|(?:describe|it|test)\s*\(['"]([^'"]+)/i,
                );
                const testName = testMatch
                  ? (testMatch[1] ?? testMatch[2] ?? "").trim()
                  : `line-${seenLines.size + 1}`;
                const lineKey = `${fileName}::${testName}::${line.slice(0, 80)}`;
                // Dedup same line across files; count unique match sites per test
                if (!seenLines.has(lineKey)) {
                  seenLines.add(lineKey);
                  testMap.set(testName, (testMap.get(testName) ?? 0) + 1);
                }
              }
            }
          }
        }
      }

      const potentialFlaky = Array.from(testMap.entries())
        .map(([test, failureCount]) => ({ test, failureCount }))
        .sort((a, b) => b.failureCount - a.failureCount)
        .slice(0, 100);

      return {
        potentialFlaky,
        totalLinesScanned: seenLines.size,
        scannedDirectories: logDirs.filter((d) => existsSync(d)),
      };
    },
  },
};

// ─── 3. test-gap-semantic ─────────────────────────────────────────────────────

function stripExt(p: string): string {
  const e = extname(p);
  return e ? p.slice(0, -e.length) : p;
}

export const testGapSemantic: ToolEntry = {
  name: "test-gap-semantic",
  tool: {
    description:
      "Compare source file exports with test file patterns to find modules without corresponding tests.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Project root or subdirectory to analyze (default: root/src)",
        },
      },
      required: [],
    },
    handler: async (args: Record<string, unknown>, root: string): Promise<unknown> => {
      const base = resolve(root);
      const dir = args.directory ? resolve(base, String(args.directory)) : join(base, "src");

      if (!existsSync(dir)) {
        return {
          untestedFiles: [],
          testedRatio: 0,
          totalSourceFiles: 0,
          message: `Directory does not exist: ${dir}`,
        };
      }

      const allFiles = walkFiles(dir);
      const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
      const testExts = new Set([
        ".test.ts",
        ".test.tsx",
        ".spec.ts",
        ".spec.tsx",
        ".test.js",
        ".spec.js",
      ]);

      const sourceFiles = allFiles.filter(
        (f) => sourceExts.has(extname(f)) && !testExts.has(extname(f)),
      );
      const testFiles = new Set(
        allFiles.filter((f) => testExts.has(extname(f))).map((f) => stripExt(f)),
      );

      const untestedFiles: string[] = [];

      for (const src of sourceFiles) {
        if (basename(src).startsWith("index.")) continue;

        const stem = stripExt(src);
        const conventions = [
          stem + ".test",
          stem + ".spec",
          join(dirname(stem), "__tests__", basename(stem) + ".test"),
          join(dirname(stem), "__tests__", basename(stem) + ".spec"),
        ];

        const hasTest = conventions.some((c) => testFiles.has(c));
        if (!hasTest) {
          untestedFiles.push(src);
        }
      }

      const totalSource = sourceFiles.length;
      const testedRatio =
        totalSource > 0
          ? Math.round(((totalSource - untestedFiles.length) / totalSource) * 10000) / 100
          : 0;

      return {
        untestedFiles: untestedFiles.slice(0, 200),
        testedRatio,
        totalSourceFiles: totalSource,
        testedFileCount: totalSource - untestedFiles.length,
      };
    },
  },
};

// ─── 4. regression-risk-scorer ────────────────────────────────────────────────

export const regressionRiskScorer: ToolEntry = {
  name: "regression-risk-scorer",
  tool: {
    description:
      "Score regression risk for changed files based on commit size, depth, and recency.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "Git ref or date to compare against (default: HEAD~10)",
        },
      },
      required: [],
    },
    handler: async (args: Record<string, unknown>, _root: string): Promise<unknown> => {
      const since = (args.since as string) ?? "HEAD~10";

      let changedFiles: string[];
      try {
        const raw = execSync(`git diff --name-only ${since}`, {
          encoding: "utf-8",
          timeout: 15000,
        });
        changedFiles = raw.trim().split("\n").filter(Boolean);
      } catch {
        return {
          highRisk: [],
          summary: {
            totalFilesChanged: 0,
            message: `Failed to run git diff against ${since}. Is 'since' a valid ref?`,
          },
        };
      }

      if (changedFiles.length === 0) {
        return {
          highRisk: [],
          summary: { totalFilesChanged: 0, message: "No changes detected." },
        };
      }

      interface FileScore {
        file: string;
        score: number;
        reason: string;
      }

      const scored: FileScore[] = [];

      for (const file of changedFiles) {
        let score = 0;
        const reasons: string[] = [];

        // Factor 1: File extension / type
        const ext = extname(file).toLowerCase();
        if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
          score += 10;
          reasons.push("source file");
        } else if ([".json", ".yaml", ".yml", ".toml"].includes(ext)) {
          score += 5;
          reasons.push("config file");
        }

        // Factor 2: Path depth (deeper = riskier)
        const depth = file.split("/").length;
        if (depth >= 4) {
          score += 10;
          reasons.push("deeply nested");
        } else if (depth >= 3) {
          score += 5;
        }

        // Factor 3: Commit count touching this file in window
        try {
          const commitCountRaw = execSync(
            `git log --oneline ${since} -- "${file}" 2>/dev/null | wc -l`,
            { encoding: "utf-8", timeout: 5000 },
          );
          const commitCount = Number.parseInt(commitCountRaw.trim(), 10) || 0;
          if (commitCount >= 3) {
            score += 15;
            reasons.push(`${commitCount} commits`);
          } else if (commitCount === 2) {
            score += 8;
            reasons.push(`${commitCount} commits`);
          }
        } catch {
          // skip commit count
        }

        // Factor 4: Recency — last commit touching the file
        try {
          const lastCommitDate = execSync(
            `git log -1 --format=%ci -- "${file}" 2>/dev/null`,
            { encoding: "utf-8", timeout: 5000 },
          ).trim();
          if (lastCommitDate) {
            const ageMs = Date.now() - new Date(lastCommitDate).getTime();
            const ageDays = ageMs / 86_400_000;
            if (ageDays <= 1) {
              score += 10;
              reasons.push("today");
            } else if (ageDays <= 7) {
              score += 5;
              reasons.push("this week");
            }
          }
        } catch {
          // skip recency
        }

        // Factor 5: File size (larger = riskier)
        try {
          const fullPath = resolve(_root, file);
          if (existsSync(fullPath)) {
            const size = statSync(fullPath).size;
            if (size > 100_000) {
              score += 10;
              reasons.push("large file >100KB");
            } else if (size > 50_000) {
              score += 5;
              reasons.push("file >50KB");
            }
          }
        } catch {
          // skip size
        }

        scored.push({
          file,
          score,
          reason: reasons.length > 0 ? reasons.join(", ") : "changed file",
        });
      }

      scored.sort((a, b) => b.score - a.score);

      const highRisk = scored.filter((s) => s.score >= 20).slice(0, 50);
      const mediumRisk = scored.filter((s) => s.score >= 10 && s.score < 20);
      const lowRisk = scored.filter((s) => s.score < 10);

      return {
        highRisk,
        summary: {
          totalFilesChanged: changedFiles.length,
          highRiskCount: highRisk.length,
          mediumRiskCount: mediumRisk.length,
          lowRiskCount: lowRisk.length,
          since,
        },
      };
    },
  },
};
