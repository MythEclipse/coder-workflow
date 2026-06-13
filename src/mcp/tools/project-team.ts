import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import type { McpTool } from "./types.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ToolEntry {
  name: string;
  tool: McpTool;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const FORMAT_ONLY_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".dart",
  ".scala",
  ".md",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "build",
  ".next",
  ".turbo",
  "vendor",
  ".gradle",
  "generated",
  "coverage",
  ".nyc_output",
  ".claude",
  "target",
  "out",
  "bin",
  "obj",
]);

/**
 * Recursively collect source file paths, skipping excluded dirs.
 */
function collectFiles(root: string): string[] {
  const result: string[] = [];
  function walk(dir: string) {
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
        if (s.isDirectory()) {
          if (SKIP_DIRS.has(entry)) continue;
          walk(full);
        } else if (s.isFile() && FORMAT_ONLY_EXTENSIONS.has(extname(full))) {
          result.push(full);
        }
      } catch {
        continue;
      }
    }
  }
  walk(root);
  return result;
}

/**
 * Safely run a git command and return trimmed stdout.
 */
function git(args: string[], cwd?: string): string {
  try {
    // Shell-escape: wrap args containing | or space in single quotes
    const escaped = args.map((a) =>
      /[|\s]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a,
    );
    return execSync(`git ${escaped.join(" ")}`, {
      encoding: "utf-8",
      cwd: cwd ?? process.cwd(),
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Safely read a file, returning null on failure.
 */
function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

type ToolHandler = McpTool["handler"];

// ─── 1. Standup Generator ──────────────────────────────────────────────────

/**
 * Reads recent git log and generates standup notes grouped by conventional-commit type.
 */
export const standupGenerator: ToolEntry = {
  name: "standup-generator",
  tool: {
    description:
      "Read recent git log (default 24h) and generate standup notes grouped by commit type",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "Git log since specifier (default '24 hours ago')",
        },
      },
    },
    handler: (async (args) => {
      const since = (args.since as string) ?? "24 hours ago";
      const raw = git(["log", `--since="${since}"`, "--pretty=format:%H|%an|%s", "--no-merges"]);
      if (!raw) return { commits: [], summary: "No commits found in the period." };

      const commits = raw.split("\n").map((line) => {
        const [hash, author, ...rest] = line.split("|");
        return { hash: hash?.slice(0, 7), author, message: rest.join("|").trim() };
      });

      const groups: Record<string, string[]> = {};
      for (const c of commits) {
        const type = (c.message.match(/^(\w+)(?:\(.+\))?:/) ?? [])[1] ?? "other";
        if (!groups[type]) groups[type] = [];
        groups[type].push(`  ${c.hash} ${c.message} (${c.author})`);
      }

      const summary = Object.entries(groups)
        .map(([type, items]) => `### ${type}\n${items.join("\n")}`)
        .join("\n\n");

      return { commits, summary };
    }) satisfies ToolHandler,
  },
};

// ─── 2. Tech Debt Tracker ──────────────────────────────────────────────────

const DEBT_PATTERN =
  /\/\/\s*(TODO|FIXME|HACK|XXX|OPTIMIZE|SECURITY|WORKAROUND|KLUDGE|TEMP|WIP)\b\s*:?\s*(.*?)$/gim;

/**
 * Scans source files for TODO/FIXME/HACK comments.
 */
export const techDebtTracker: ToolEntry = {
  name: "tech-debt-tracker",
  tool: {
    description:
      "Scan source files for TODO/FIXME/HACK comments and return structured tech debt items",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to scan (default: current working directory)",
        },
      },
    },
    handler: (async (args, root) => {
      const dir = resolve((args.directory as string) ?? root);
      const files = collectFiles(dir);

      const items: { file: string; line: number; text: string; type: string }[] = [];

      for (const file of files) {
        const relPath = relative(dir, file).replace(/\\/g, "/");
        const content = readFileSafe(file);
        if (!content) continue;

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          DEBT_PATTERN.lastIndex = 0;
          const match = DEBT_PATTERN.exec(lines[i]);
          if (match) {
            items.push({
              file: relPath,
              line: i + 1,
              text: (match[2] || match[1]).trim(),
              type: match[1].toUpperCase(),
            });
          }
        }
      }

      return { total: items.length, items };
    }) satisfies ToolHandler,
  },
};

// ─── 3. Bus Factor Calculator ──────────────────────────────────────────────

interface BlameEntry {
  file: string;
  authors: string[];
  totalLines: number;
}

/**
 * Analyze git blame per file to find those owned by few authors.
 */
export const busFactorCalculator: ToolEntry = {
  name: "bus-factor-calculator",
  tool: {
    description: "Analyze git blame to find files owned by few authors (bus factor risk)",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to analyze (default: current working directory)",
        },
        threshold: {
          type: "number",
          description: "Maximum unique authors before a file is considered at risk (default: 2)",
        },
      },
    },
    handler: (async (args, root) => {
      const dir = resolve((args.directory as string) ?? root);
      const threshold = (args.threshold as number) ?? 2;
      const files = collectFiles(dir);
      const blameEntries: BlameEntry[] = [];

      for (const file of files) {
        const relPath = relative(dir, file).replace(/\\/g, "/");
        const authorOutput = git(["blame", "--line-porcelain", "--", file], dir);
        if (!authorOutput) continue;

        const authors = new Set<string>();
        for (const line of authorOutput.split("\n")) {
          if (line.startsWith("author ")) {
            const name = line.slice(7).trim();
            if (name) authors.add(name);
          }
        }

        blameEntries.push({
          file: relPath,
          authors: [...authors],
          totalLines: authors.size, // number of unique authors = bus factor indicator
        });
      }

      const risk = blameEntries
        .filter((e) => e.authors.length <= threshold)
        .sort((a, b) => a.authors.length - b.authors.length)
        .map((e) => ({
          file: e.file,
          authors: e.authors,
          risk: e.authors.length === 0 ? "high" : e.authors.length === 1 ? "high" : "medium",
        }));

      return { busFactorRisk: risk };
    }) satisfies ToolHandler,
  },
};

// ─── 4. Review Fatigue Detector ────────────────────────────────────────────

interface AuthorCount {
  name: string;
  count: number;
}

/**
 * Count recent commits per author as a proxy for review fatigue detection.
 */
export const reviewFatigueDetector: ToolEntry = {
  name: "review-fatigue-detector",
  tool: {
    description: "Count recent commits per author as a proxy for review fatigue detection",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "Git log since specifier (default '7 days ago')",
        },
      },
    },
    handler: (async (args) => {
      const since = (args.since as string) ?? "7 days ago";
      const raw = git(["log", `--since="${since}"`, "--pretty=format:%an", "--no-merges"]);
      if (!raw) return { authors: [], fatigueRisk: false };

      const counts = new Map<string, number>();
      for (const author of raw.split("\n")) {
        const trimmed = author.trim();
        if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
      }

      const authors: AuthorCount[] = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

      const total = authors.reduce((s, a) => s + a.count, 0);
      const fatigueRisk = authors.some((a) => total > 0 && a.count / total > 0.5);

      return { authors, fatigueRisk };
    }) satisfies ToolHandler,
  },
};

// ─── 5. Onboarding Path Generator ──────────────────────────────────────────

/**
 * Read common project docs and generate structured onboarding steps.
 */
export const onboardingPathGenerator: ToolEntry = {
  name: "onboarding-path-generator",
  tool: {
    description: "Read README, CLAUDE.md, CONTRIBUTING.md and generate structured onboarding steps",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: (async (_args, root) => {
      const docs: Record<string, string | null> = {};
      const candidates = ["README.md", "CLAUDE.md", "CONTRIBUTING.md", "CONTRIBUTING.adoc"];
      for (const name of candidates) {
        docs[name] = readFileSafe(join(root, name));
      }

      let projectType = "unknown";
      if (existsSync(join(root, "package.json"))) projectType = "node";
      else if (existsSync(join(root, "Cargo.toml"))) projectType = "rust";
      else if (existsSync(join(root, "go.mod"))) projectType = "go";
      else if (existsSync(join(root, "pom.xml")) || existsSync(join(root, "build.gradle"))) {
        projectType = "java";
      } else if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "setup.py"))) {
        projectType = "python";
      }

      const recommendedSteps = [
        "1. Read the README for project overview and setup instructions.",
        "2. Review CLAUDE.md for AI-assisted development conventions (if present).",
        "3. Check CONTRIBUTING.md for contribution workflow and code standards.",
        "4. Run the install/setup command specified in the README.",
        "5. Explore the directory structure to understand module layout.",
        "6. Look at existing tests to understand testing patterns.",
        "7. Find the issue tracker or task board for open work items.",
      ];

      return { docs, projectType, recommendedSteps };
    }) satisfies ToolHandler,
  },
};

// ─── 6. Decision Log MCP ───────────────────────────────────────────────────

interface AdrEntry {
  id: number;
  title: string;
  status: string;
  date: string;
}

/**
 * ADR reader: list all ADRs or get a single one by ID.
 */
export const decisionLogMCP: ToolEntry = {
  name: "decision-log-mcp",
  tool: {
    description: "List and retrieve Architecture Decision Records (ADRs) from the project",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action: 'list' to list all ADRs, 'get' to retrieve a specific ADR",
          enum: ["list", "get"],
        },
        id: {
          type: "number",
          description: "ADR ID to retrieve (required when action is 'get')",
        },
      },
      required: ["action"],
    },
    handler: (async (args, root) => {
      const action = args.action as string;

      const adrDirs = [
        join(root, "docs", "adr"),
        join(root, "docs", "architecture", "decisions"),
        join(root, "adr"),
      ];

      const adrDir = adrDirs.find((d) => existsSync(d));
      if (!adrDir) return { adrs: [], message: "No ADR directory found." };

      const files = readdirSync(adrDir)
        .filter((f) => /^\d{4}-.+\.(md|adoc)$/i.test(f))
        .sort();

      const adrs: AdrEntry[] = [];
      for (const file of files) {
        const match = file.match(/^(\d{4})-(.+)\.(md|adoc)$/i);
        if (!match) continue;

        const id = Number.parseInt(match[1], 10);
        const titleRaw = match[2].replace(/[-_]/g, " ");
        const title = titleRaw.charAt(0).toUpperCase() + titleRaw.slice(1);

        const content = readFileSafe(join(adrDir, file));
        let status = "proposed";
        if (content) {
          const statusMatch = content.match(/status:\s*(\w+)/i);
          if (statusMatch) status = statusMatch[1].toLowerCase();
        }

        const dateMatch = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : "unknown";

        adrs.push({ id, title, status, date });
      }

      if (action === "get") {
        const targetId = args.id as number | undefined;
        if (targetId === undefined) {
          return { adrs, message: "No ADR ID provided for 'get' action." };
        }
        const adr = adrs.find((a) => a.id === targetId);
        if (!adr) {
          return { adrs, message: `ADR #${targetId} not found.` };
        }
        const adrFile = files.find((f) => f.startsWith(String(targetId)));
        const content = adrFile ? readFileSafe(join(adrDir, adrFile)) : null;
        return { adrs: [adr], content, file: adrFile };
      }

      return { adrs };
    }) satisfies ToolHandler,
  },
};

// ─── 7. Institutional Memory MCP ───────────────────────────────────────────

/**
 * Read .claude/memory/ or project memory files and return cross-referenced knowledge.
 */
export const institutionalMemoryMCP: ToolEntry = {
  name: "institutional-memory-mcp",
  tool: {
    description:
      "Read project memory files (.claude/memory/) and return cross-referenced knowledge",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional search term to filter memories by name or content",
        },
      },
    },
    handler: (async (args, root) => {
      const query = ((args.query as string) ?? "").toLowerCase();

      const candidates = [
        join(root, ".claude", "memory"),
        join(root, ".claude", "memories"),
        join(root, "docs", "memory"),
      ];
      const memoryDir = candidates.find((d) => existsSync(d));
      if (!memoryDir) {
        return { memories: [], message: "No memory directory found." };
      }

      const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
      const memories: {
        name: string;
        description: string;
        content: string;
      }[] = [];

      for (const file of files) {
        const content = readFileSafe(join(memoryDir, file));
        if (!content) continue;

        const name = file.replace(/\.md$/, "").replace(/[-_]/g, " ");

        const descMatch = content.match(/^#\s+(.+)/m) ?? content.match(/^(.+)/);
        const description = descMatch ? descMatch[1].trim().slice(0, 200) : name;

        const entry = { name, description, content };

        if (query) {
          const haystack = `${name} ${description} ${content}`.toLowerCase();
          if (!haystack.includes(query)) continue;
        }

        memories.push(entry);
      }

      return { memories };
    }) satisfies ToolHandler,
  },
};
