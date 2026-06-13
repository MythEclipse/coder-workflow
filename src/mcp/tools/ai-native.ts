import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry {
  name: string;
  tool: McpTool;
}

const CHARS_PER_TOKEN = 4;
const COST_PER_TOKEN = 0.000003;

function collectFiles(root: string, ext?: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectFiles(full, ext));
      } else if (!ext || entry.name.endsWith(ext)) {
        files.push(full);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return files;
}

function extractVersion(filePath: string): string {
  const semver = filePath.match(/v?(\d+\.\d+\.\d+)/);
  if (semver) return semver[1];
  const name = filePath.match(/[\\/]([^\\/]+?)\.md$/);
  if (name) return `1.0.0-${name[1].toLowerCase().replace(/\s+/g, "-")}`;
  return "1.0.0-unversioned";
}

export const promptVersionControl: ToolEntry = {
  name: "prompt-version-control",
  tool: {
    description: "Scan .claude/ directory for prompt, skill, and agent files and track versions",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: async (_args: Record<string, unknown>, root: string) => {
      const claudeDir = join(root, ".claude");
      const mdFiles = collectFiles(claudeDir, ".md");
      const files = mdFiles
        .filter(
          (f) =>
            f.includes("prompt") ||
            f.includes("skill") ||
            f.includes("agent") ||
            f.includes("CLAUDE"),
        )
        .map((f) => ({
          path: relative(root, f),
          version: extractVersion(f),
          lastModified: statSync(f).mtime.toISOString(),
        }));
      return { files };
    },
  },
};

export const llmCostAttribution: ToolEntry = {
  name: "llm-cost-attribution",
  tool: {
    description:
      "Estimate token usage from session logs and calculate approximate cost",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 30)",
        },
      },
      required: [],
    },
    handler: async (args: Record<string, unknown>, root: string) => {
      const days = (args.days as number) ?? 30;
      const cutoff = Date.now() - days * 86_400_000;
      const logDirs = [join(root, ".claude", "logs"), join(root, "logs")];
      const logFiles: string[] = [];
      for (const dir of logDirs) {
        if (existsSync(dir)) {
          logFiles.push(...collectFiles(dir, ".md"));
          logFiles.push(...collectFiles(dir, ".log"));
          logFiles.push(...collectFiles(dir, ".json"));
        }
      }
      let totalChars = 0;
      let sessions = 0;
      for (const f of logFiles) {
        try {
          const st = statSync(f);
          if (st.mtimeMs < cutoff) continue;
          const content = readFileSync(f, "utf-8");
          totalChars += content.length;
          sessions++;
        } catch {
          // skip unreadable files
        }
      }
      const estimatedTokens = Math.round(totalChars / CHARS_PER_TOKEN);
      const cost = (estimatedTokens * COST_PER_TOKEN).toFixed(6);
      return {
        sessions,
        estimatedTokens,
        estimatedCost: `$${cost}`,
      };
    },
  },
};

export const contextWindowOptimizer: ToolEntry = {
  name: "context-window-optimizer",
  tool: {
    description:
      "Analyze CLAUDE.md and agent files for size and recommend splitting",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: async (_args: Record<string, unknown>, root: string) => {
      const targets = [
        join(root, "CLAUDE.md"),
        ...collectFiles(join(root, ".claude", "agents"), ".md"),
        ...collectFiles(join(root, ".claude", "skills"), ".md"),
        ...collectFiles(join(root, ".claude", "prompts"), ".md"),
      ];
      const files = targets
        .filter((f) => existsSync(f))
        .map((f) => {
          const st = statSync(f);
          const sizeKB = Math.round(st.size / 1024);
          let suggestion: string;
          if (sizeKB < 5) {
            suggestion = "OK — file is small";
          } else if (sizeKB < 15) {
            suggestion = "Consider splitting into smaller focused files";
          } else {
            suggestion = "Split recommended — large file reduces context efficiency";
          }
          return {
            path: relative(root, f),
            size: `${sizeKB} KB`,
            suggestion,
          };
        });
      return { files };
    },
  },
};
