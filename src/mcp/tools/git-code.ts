import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry { name: string; tool: McpTool }

function tryExec(cmd: string, fallback = ""): string {
  try { return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch { return fallback; }
}

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

// ─── 1. CI/CD Monitor ────────────────────────────────────────────────
export const ciCdMonitor: ToolEntry = {
  name: "ci-cd-monitor",
  tool: {
    description: "Scans recent git commits and CI status",
    inputSchema: { type: "object", properties: { days: { type: "number" }, branch: { type: "string" } } },
    handler: async (args, root) => {
      const days = (args.days as number) ?? 1;
      const branch = (args.branch as string) ?? "HEAD";
      const since = `${days}.days.ago`;
      const log = tryExec(`git log ${branch} --since="${since}" --oneline --format="%H|%an|%ad|%s" --date=short`);
      const commits = log ? log.split("\n").filter(Boolean).map((l: string) => {
        const [hash, author, date, ...msg] = l.split("|");
        return { hash: hash?.slice(0, 8), author, date, message: msg.join("|") };
      }) : [];
      return { recentCommits: commits, ciStatus: "N/A" };
    },
  },
};

// ─── 2. Codebase Time Machine ─────────────────────────────────────────
export const codebaseTimeMachine: ToolEntry = {
  name: "codebase-time-machine",
  tool: {
    description: "Generates diff summary between two git refs",
    inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
    handler: async (args, root) => {
      const from = args.from as string;
      const to = args.to as string;
      const diff = tryExec(`git diff --numstat ${from}..${to} 2>/dev/null || git diff --numstat ${from}...${to}`);
      if (!diff) return { files: [], message: `No diff between ${from} and ${to}` };
      const files = diff.split("\n").filter(Boolean).map((l: string) => {
        const [additions, deletions, path] = l.split("\t");
        return { path, additions: parseInt(additions || "0"), deletions: parseInt(deletions || "0"), changeType: "modified" };
      });
      return { files };
    },
  },
};

// ─── 3. Dead Code Archaeologist ───────────────────────────────────────
export const deadCodeArchaeologist: ToolEntry = {
  name: "dead-code-archaeologist",
  tool: {
    description: "Scans for files not imported by any other tracked file",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || "src");
      if (!existsSync(dir)) return { potentialDead: [], message: "Directory not found" };
      const files = listFiles(dir, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const imports: string[] = [];
      for (const f of files) {
        try { const content = readFileSync(f, "utf-8"); const m = content.matchAll(/from\s+['"]([^'"]+)['"]/g); for (const mm of m) imports.push(mm[1]); } catch { /* skip */ }
      }
      const potentialDead = files.filter((f) => {
        const name = relative(root, f).replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx)$/, "");
        return !imports.some((i) => i === name || i.endsWith("/" + name.split("/").pop()));
      });
      return { potentialDead: potentialDead.map((f) => relative(root, f)) };
    },
  },
};

// ─── 4. Dependency Impact Predictor ───────────────────────────────────
export const dependencyImpactPredictor: ToolEntry = {
  name: "dependency-impact-predictor",
  tool: {
    description: "Finds all files that import from a given module path",
    inputSchema: { type: "object", properties: { modulePath: { type: "string" } }, required: ["modulePath"] },
    handler: async (args, root) => {
      const modulePath = args.modulePath as string;
      const files = listFiles(root, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const dependents: string[] = [];
      for (const f of files) {
        try {
          const content = readFileSync(f, "utf-8");
          const pattern = new RegExp(`from\\s+['"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`);
          if (pattern.test(content)) dependents.push(relative(root, f));
        } catch { /* skip */ }
      }
      return { dependents };
    },
  },
};

// ─── 5. Coupling Heatmap ──────────────────────────────────────────────
export const couplingHeatmap: ToolEntry = {
  name: "coupling-heatmap",
  tool: {
    description: "Counts how many files import each top-level src directory module",
    inputSchema: { type: "object", properties: {} },
    handler: async (args, root) => {
      const src = join(root, "src");
      if (!existsSync(src)) return { couplings: [] };
      const modules = readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      const allFiles = listFiles(src, (f) => /\.(ts|tsx|js|jsx)$/.test(f));
      const couplings = modules.map((mod) => {
        const pattern = new RegExp(`from\\s+['"].*?${mod}[\\/'".]`);
        let importedBy = 0;
        for (const f of allFiles) {
          try { const c = readFileSync(f, "utf-8"); const mm = c.match(/from\s+['"][^'"]+/g) || []; if (mm.some((m) => m.includes(mod))) importedBy++; } catch { /* skip */ }
        }
        return { module: mod, importedBy, totalImports: allFiles.length };
      });
      return { couplings };
    },
  },
};

// ─── 6. API Contract Drifter ──────────────────────────────────────────
export const apiContractDrifter: ToolEntry = {
  name: "api-contract-drifter",
  tool: {
    description: "Compares API route definitions between two branches",
    inputSchema: { type: "object", properties: { baseBranch: { type: "string" }, headBranch: { type: "string" } } },
    handler: async (args, root) => {
      const base = (args.baseBranch as string) || "main";
      const head = (args.headBranch as string) || "HEAD";
      const baseStr = tryExec(`git show ${base}:src/mcp-server.ts 2>/dev/null || true`);
      const headStr = tryExec(`git show ${head}:src/mcp-server.ts 2>/dev/null || true`);
      const baseArr: string[] = baseStr.match(/['"](get|post|put|delete|patch)\s+[^'"]+['"]/gi) || [];
      const headArr: string[] = headStr.match(/['"](get|post|put|delete|patch)\s+[^'"]+['"]/gi) || [];
      const added = headArr.filter((r) => !baseArr.includes(r));
      const removed = baseArr.filter((r) => !headArr.includes(r));
      return { changes: [...added.map((r: string) => `+ ${r}`), ...removed.map((r: string) => `- ${r}`)] };
    },
  },
};

// ─── 7. Cross-Repo Semantic Search ────────────────────────────────────
export const crossRepoSemanticSearch: ToolEntry = {
  name: "cross-repo-semantic-search",
  tool: {
    description: "Simple keyword search across source files",
    inputSchema: { type: "object", properties: { query: { type: "string" }, directory: { type: "string" } }, required: ["query"] },
    handler: async (args, root) => {
      const query = args.query as string;
      const dir = resolve(root, (args.directory as string) || root);
      if (!query) return { results: [] };
      const files = listFiles(dir, (f) => /\.(ts|tsx|js|jsx|py|go|rs|java|md)$/.test(f));
      const results: Array<{ file: string; line: number; content: string }> = [];
      for (const f of files) {
        try {
          const lines = readFileSync(f, "utf-8").split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              results.push({ file: relative(root, f), line: i + 1, content: lines[i].trim().slice(0, 200) });
            }
          }
        } catch { /* skip */ }
      }
      return { results };
    },
  },
};
