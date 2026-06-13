import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry { name: string; tool: McpTool }

function tryExec(cmd: string, fallback = ""): string {
  try { return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch { return fallback; }
}

// ─── 1. Standup Generator ─────────────────────────────────────────────
export const standupGenerator: ToolEntry = {
  name: "standup-generator",
  tool: {
    description: "Reads recent git log and generates standup notes grouped by type",
    inputSchema: { type: "object", properties: { since: { type: "string" } } },
    handler: async (args, root) => {
      const since = (args.since as string) || "24.hours.ago";
      const log = tryExec(`git log --since="${since}" --format="%an|%s" --no-merges`);
      const commits = log ? log.split("\n").filter(Boolean).map((l: string) => {
        const [author, ...msg] = l.split("|");
        return { author, message: msg.join("|") };
      }) : [];
      const counts: Record<string, number> = {};
      for (const c of commits) {
        const type = c.message.match(/^(feat|fix|chore|docs|refactor|test|perf)/)?.[1] || "other";
        counts[type] = (counts[type] || 0) + 1;
      }
      return { commits, summary: { total: commits.length, byType: counts } };
    },
  },
};

// ─── 2. Tech Debt Tracker ─────────────────────────────────────────────
export const techDebtTracker: ToolEntry = {
  name: "tech-debt-tracker",
  tool: {
    description: "Scans TODO/FIXME/HACK comments in source files",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const items: Array<{ file: string; line: number; text: string; type: string }> = [];
      function scan(p: string) {
        try {
          for (const e of readdirSync(p, { withFileTypes: true })) {
            const f = join(p, e.name);
            if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") scan(f);
            else if (e.isFile() && /\.(ts|tsx|js|jsx|py|go|rs|java)$/.test(e.name)) {
              const lines = readFileSync(f, "utf-8").split("\n");
              for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/(TODO|FIXME|HACK|XXX|TEMP|WIP)(?:\s*[:-]?\s*(.*))?/i);
                if (m) items.push({ file: relative(root, f), line: i + 1, text: (m[2] || m[1]).trim().slice(0, 150), type: m[1].toUpperCase() });
              }
            }
          }
        } catch { /* skip */ }
      }
      if (existsSync(dir)) scan(dir);
      return { total: items.length, items };
    },
  },
};

// ─── 3. Bus Factor Calculator ─────────────────────────────────────────
export const busFactorCalculator: ToolEntry = {
  name: "bus-factor-calculator",
  tool: {
    description: "Analyzes git blame to find files owned by few authors",
    inputSchema: { type: "object", properties: { directory: { type: "string" }, threshold: { type: "number" } } },
    handler: async (args, root) => {
      const threshold = (args.threshold as number) ?? 2;
      const dir = resolve(root, (args.directory as string) || root);
      const files = tryExec(`git ls-files "${relative(root, dir)}" 2>/dev/null`).split("\n").filter(Boolean).slice(0, 100);
      const risk: Array<{ file: string; authors: string[]; risk: string }> = [];
      for (const f of files) {
        const blame = tryExec(`git blame --line-porcelain "${f}" 2>/dev/null | grep "^author " | sort -u`);
        const authors = blame ? [...new Set(blame.split("\n").filter(Boolean).map((l: string) => l.replace("author ", "")))] : [];
        if (authors.length > 0 && authors.length <= threshold)
          risk.push({ file: f, authors, risk: authors.length === 1 ? "high" : "medium" });
      }
      return { busFactorRisk: risk };
    },
  },
};

// ─── 4. Review Fatigue Detector ───────────────────────────────────────
export const reviewFatigueDetector: ToolEntry = {
  name: "review-fatigue-detector",
  tool: {
    description: "Counts recent PRs/reviews by author from git log",
    inputSchema: { type: "object", properties: { since: { type: "string" } } },
    handler: async (args, root) => {
      const since = (args.since as string) || "7.days.ago";
      const log = tryExec(`git log --since="${since}" --format="%an" --no-merges`);
      const authors = log ? log.split("\n").filter(Boolean).reduce<Record<string, number>>((acc, a) => { acc[a] = (acc[a] || 0) + 1; return acc; }, {}) : {};
      const entries = Object.entries(authors).map(([name, count]) => ({ name, count }));
      const maxCount = Math.max(...entries.map((e) => e.count), 0);
      return { authors: entries, fatigueRisk: maxCount > 10, maxCommitsByOneAuthor: maxCount };
    },
  },
};

// ─── 5. Onboarding Path Generator ─────────────────────────────────────
export const onboardingPathGenerator: ToolEntry = {
  name: "onboarding-path-generator",
  tool: {
    description: "Reads README, CLAUDE.md, CONTRIBUTING.md and generates structured onboarding steps",
    inputSchema: { type: "object", properties: {} },
    handler: async (args, root) => {
      const docs: string[] = [];
      for (const name of ["README.md", "CLAUDE.md", "CONTRIBUTING.md"]) {
        const p = join(root, name);
        if (existsSync(p)) docs.push(name);
      }
      const hasPackageJson = existsSync(join(root, "package.json"));
      const hasDocker = existsSync(join(root, "Dockerfile")) || existsSync(join(root, "docker-compose.yml"));
      const recommendedSteps = [
        "Clone the repository",
        ...(docs.includes("README.md") ? ["Read README.md for project overview"] : []),
        ...(docs.includes("CLAUDE.md") ? ["Review CLAUDE.md for development guidelines"] : []),
        ...(hasPackageJson ? ["Install dependencies: npm install"] : []),
        ...(hasDocker ? ["Start with Docker: docker compose up"] : []),
        ...(docs.includes("CONTRIBUTING.md") ? ["Read CONTRIBUTING.md for contribution guidelines"] : []),
      ];
      return { docs, projectType: hasPackageJson ? "Node.js" : hasDocker ? "Docker" : "Unknown", recommendedSteps };
    },
  },
};

// ─── 6. Decision Log MCP (ADR Reader) ─────────────────────────────────
export const decisionLogMcp: ToolEntry = {
  name: "decision-log-mcp",
  tool: {
    description: "Lists and retrieves Architecture Decision Records",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["list", "get"] }, id: { type: "number" } }, required: ["action"] },
    handler: async (args, root) => {
      const action = args.action as string;
      const adrDir = join(root, "docs", "adr");
      if (!existsSync(adrDir)) return { adrs: [], message: "No ADR directory found" };
      if (action === "list") {
        const files = readdirSync(adrDir).filter((f) => f.endsWith(".md")).sort();
        const adrs = files.map((f) => {
          const content = readFileSync(join(adrDir, f), "utf-8");
          const title = content.match(/^#\s+(.+)/m)?.[1] || f.replace(/\.md$/, "");
          const status = content.match(/\*\*Status\*\*:\s*(.+)/i)?.[1] || "unknown";
          const date = content.match(/\*\*Date\*\*:\s*(.+)/i)?.[1] || "";
          const id = parseInt(f.match(/^(\d+)/)?.[1] || "0");
          return { id, title, status: status.trim(), date: date.trim(), file: f };
        });
        return { adrs };
      }
      if (action === "get") {
        const id = args.id as number;
        const file = readdirSync(adrDir).find((f) => f.startsWith(String(id).padStart(4, "0")));
        if (!file) return { error: `ADR #${id} not found` };
        const content = readFileSync(join(adrDir, file), "utf-8");
        return { content, file };
      }
      return { error: `Unknown action: ${action}` };
    },
  },
};

// ─── 7. Institutional Memory MCP ──────────────────────────────────────
export const institutionalMemoryMcp: ToolEntry = {
  name: "institutional-memory-mcp",
  tool: {
    description: "Reads project memory files and returns cross-referenced knowledge",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    handler: async (args, root) => {
      const query = (args.query as string || "").toLowerCase();
      const memoryDirs = [
        join(root, ".claude", "memory"),
        join(root, ".claude", "project-knowledge"),
      ];
      const memories: Array<{ name: string; description: string; content: string }> = [];
      for (const dir of memoryDirs) {
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
          if (!file.endsWith(".md")) continue;
          try {
            const content = readFileSync(join(dir, file), "utf-8");
            const name = file.replace(/\.md$/, "");
            const desc = content.match(/description:\s*(.+)/i)?.[1] || name;
            if (!query || content.toLowerCase().includes(query) || desc.toLowerCase().includes(query))
              memories.push({ name, description: desc, content: content.slice(0, 500) });
          } catch { /* skip */ }
        }
      }
      return { memories };
    },
  },
};
