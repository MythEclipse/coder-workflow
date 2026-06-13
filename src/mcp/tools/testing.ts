import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry { name: string; tool: McpTool }

function listFiles(dir: string, predicate: (f: string) => boolean): string[] {
  const result: string[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") result.push(...listFiles(full, predicate));
      else if (e.isFile() && predicate(full)) result.push(full);
    }
  } catch { /* skip */ }
  return result;
}

// ─── 1. Test Coverage Reporter ────────────────────────────────────────
export const testCoverageReporter: ToolEntry = {
  name: "test-coverage-reporter",
  tool: {
    description: "Checks for coverage reports and reports coverage summary",
    inputSchema: { type: "object", properties: {} },
    handler: async (args, root) => {
      const coverageDir = join(root, "coverage");
      if (!existsSync(coverageDir)) return { hasCoverageReport: false, message: "No coverage/ directory found" };
      const lcov = join(coverageDir, "lcov.info");
      const json = join(coverageDir, "coverage-final.json");
      if (existsSync(lcov)) {
        const content = readFileSync(lcov, "utf-8");
        const files = content.split("\n").filter((l) => l.startsWith("SF:")).map((l) => l.replace("SF:", ""));
        const lines = content.match(/^DA:\d+,\d+/gm);
        return { hasCoverageReport: true, source: "lcov.info", totalFiles: files.length, totalLines: lines?.length || 0 };
      }
      if (existsSync(json)) {
        const data = JSON.parse(readFileSync(json, "utf-8"));
        const files = Object.keys(data).length;
        return { hasCoverageReport: true, source: "coverage-final.json", totalFiles: files };
      }
      return { hasCoverageReport: false, message: "Coverage directory exists but no known report format found" };
    },
  },
};

// ─── 2. Flaky Test Historian ──────────────────────────────────────────
export const flakyTestHistorian: ToolEntry = {
  name: "flaky-test-historian",
  tool: {
    description: "Scans test output and CI artifacts for retry patterns",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const logs = listFiles(dir, (f) => /\.(log|txt|json|xml)$/.test(f) && (f.includes("test") || f.includes("result")));
      const flaky: Array<{ test: string; failureCount: number }> = [];
      for (const f of logs) {
        try {
          const content = readFileSync(f, "utf-8");
          const retries = content.matchAll(/(?:rerun|retry|flaky|RERUN|RETRY|FLAKY)\s*[:\s]+([^\n]+)/gi);
          for (const m of retries) {
            const existing = flaky.find((x) => x.test === m[1].trim());
            if (existing) existing.failureCount++;
            else flaky.push({ test: m[1].trim(), failureCount: 1 });
          }
        } catch { /* skip */ }
      }
      return { potentialFlaky: flaky };
    },
  },
};

// ─── 3. Test Gap Semantic ─────────────────────────────────────────────
export const testGapSemantic: ToolEntry = {
  name: "test-gap-semantic",
  tool: {
    description: "Compares source files with test files to find untested modules",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const allFiles = listFiles(dir, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const testFiles = allFiles.filter((f) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f) || f.includes("__tests__"));
      const sourceFiles = allFiles.filter((f) => !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f) && !f.includes("__tests__"));
      const tested = new Set<string>();
      for (const tf of testFiles) {
        const content = readFileSync(tf, "utf-8");
        const imports = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
        for (const m of imports) {
          const path = m[1].startsWith(".") ? resolve(dir, m[1]) : m[1];
          sourceFiles.forEach((sf) => { if (sf.includes(path) || path.includes(sf)) tested.add(sf); });
        }
      }
      const untestedFiles = sourceFiles.filter((f) => !tested.has(f) && !f.includes("node_modules")).map((f) => relative(root, f));
      return { untestedFiles, testedRatio: sourceFiles.length > 0 ? Math.round((tested.size / sourceFiles.length) * 100) / 100 : 0 };
    },
  },
};

// ─── 4. Regression Risk Scorer ────────────────────────────────────────
export const regressionRiskScorer: ToolEntry = {
  name: "regression-risk-scorer",
  tool: {
    description: "Scores risk for changed files by commit size, depth, and recency",
    inputSchema: { type: "object", properties: { since: { type: "string" } } },
    handler: async (args, root) => {
      const since = (args.since as string) || "7.days.ago";
      const { execSync } = await import("node:child_process");
      let diff = "";
      try { diff = execSync(`git diff --name-only --diff-filter=ACM ${since}`, { encoding: "utf-8" }); }
      catch { return { highRisk: [], summary: { totalChanged: 0, message: "Git error" } }; }
      const files = diff.split("\n").filter(Boolean);
      const highRisk: Array<{ file: string; score: number; reason: string }> = [];
      for (const f of files) {
        let score = 0;
        const reasons: string[] = [];
        if (f.includes("config") || f.includes("schema") || f.includes("migration")) { score += 3; reasons.push("config/schema file"); }
        if (f.includes("test") || f.includes("spec")) score -= 2;
        try {
          const stat = execSync(`git diff --numstat ${since} -- "${f}"`, { encoding: "utf-8" });
          const [, add, del] = stat.split("\t").map(Number);
          if ((add || 0) > 100) { score += 2; reasons.push(`large: +${add} lines`); }
        } catch { /* skip */ }
        if (score >= 3) highRisk.push({ file: f, score, reason: reasons.join(", ") });
      }
      return { highRisk, summary: { totalChanged: files.length, highRiskFiles: highRisk.length } };
    },
  },
};
