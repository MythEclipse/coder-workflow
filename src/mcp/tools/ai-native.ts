import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry { name: string; tool: McpTool }

// ─── 1. Prompt Version Control ────────────────────────────────────────
export const promptVersionControl: ToolEntry = {
  name: "prompt-version-control",
  tool: {
    description: "Scans .claude/ directory for prompt/skill/agent files and tracks versions",
    inputSchema: { type: "object", properties: {} },
    handler: async (args, root) => {
      const dirs = [join(root, ".claude"), join(root, "agents"), join(root, "skills")];
      const files: Array<{ path: string; version: string; lastModified: string }> = [];
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        const scan = (p: string) => {
          try {
            for (const e of readdirSync(p, { withFileTypes: true })) {
              const full = join(p, e.name);
              if (e.isDirectory() && !e.name.startsWith(".")) scan(full);
              else if (e.isFile() && e.name.endsWith(".md")) {
                const content = readFileSync(full, "utf-8");
                const v = content.match(/version:\s*(.+)/i)?.[1]?.trim() || "unknown";
                const lm = statSync(full).mtime.toISOString();
                files.push({ path: full.replace(root, "").replace(/^\//, ""), version: v, lastModified: lm });
              }
            }
          } catch { /* skip */ }
        };
        scan(dir);
      }
      return { files: files.sort((a, b) => b.lastModified.localeCompare(a.lastModified)) };
    },
  },
};

// ─── 2. LLM Cost Attribution ──────────────────────────────────────────
export const llmCostAttribution: ToolEntry = {
  name: "llm-cost-attribution",
  tool: {
    description: "Estimates token usage from session logs and calculates approximate cost",
    inputSchema: { type: "object", properties: { days: { type: "number" } } },
    handler: async (args, root) => {
      const days = (args.days as number) ?? 7;
      const logDir = join(root, ".claude");
      if (!existsSync(logDir)) return { sessions: 0, estimatedTokens: 0, estimatedCost: "$0.00" };
      const logs = readdirSync(logDir).filter((f) => f.startsWith("session-") && f.endsWith(".log"));
      const recentLogs = logs.filter(() => true).slice(0, 10);
      let totalBytes = 0;
      for (const l of recentLogs) {
        try { totalBytes += statSync(join(logDir, l)).size; } catch { /* skip */ }
      }
      const estimatedTokens = Math.round(totalBytes / 4); // rough estimate
      const costPer1KTokens = 0.003; // Claude Haiku pricing
      const cost = (estimatedTokens / 1000) * costPer1KTokens * days;
      return { sessions: recentLogs.length, estimatedTokens, estimatedCost: `$${cost.toFixed(2)}` };
    },
  },
};

// ─── 3. Context Window Optimizer ──────────────────────────────────────
export const contextWindowOptimizer: ToolEntry = {
  name: "context-window-optimizer",
  tool: {
    description: "Analyzes CLAUDE.md and agent files for size and recommends splitting",
    inputSchema: { type: "object", properties: {} },
    handler: async (args, root) => {
      const files: Array<{ path: string; size: number; lines: number; suggestion: string }> = [];
      const targets = ["CLAUDE.md", "README.md", "CONTRIBUTING.md"];
      for (const t of targets) {
        const p = join(root, t);
        if (existsSync(p)) {
          const content = readFileSync(p, "utf-8");
          const size = content.length;
          const lines = content.split("\n").length;
          let suggestion = "ok";
          if (size > 10000) suggestion = "split into multiple files";
          else if (size > 5000) suggestion = "consider splitting";
          files.push({ path: t, size, lines, suggestion });
        }
      }
      const agentsDir = join(root, "agents");
      if (existsSync(agentsDir)) {
        for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
          const p = join(agentsDir, f);
          const content = readFileSync(p, "utf-8");
          const size = content.length;
          const lines = content.split("\n").length;
          let suggestion = "ok";
          if (size > 5000) suggestion = "consider splitting agent instructions";
          files.push({ path: `agents/${f}`, size, lines, suggestion });
        }
      }
      return { files };
    },
  },
};
