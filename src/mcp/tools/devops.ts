import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry { name: string; tool: McpTool }

// ─── 1. Environment/Secret Validator ──────────────────────────────────
export const environmentSecretValidator: ToolEntry = {
  name: "environment-secret-validator",
  tool: {
    description: "Validates .env file against a schema or .env.example for missing/extra keys",
    inputSchema: { type: "object", properties: { envPath: { type: "string" }, schema: { type: "object" } } },
    handler: async (args, root) => {
      const envPath = (args.envPath as string) ? join(root, args.envPath as string) : join(root, ".env");
      if (!existsSync(envPath)) return { valid: false, issues: [{ key: ".env", problem: "File not found" }] };
      const envContent = readFileSync(envPath, "utf-8");
      const envKeys = envContent.split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("=")[0].trim()).filter(Boolean);
      const issues: Array<{ key: string; problem: string }> = [];
      if (args.schema && typeof args.schema === "object") {
        const schema = args.schema as Record<string, string>;
        for (const [key, _type] of Object.entries(schema)) {
          if (!envKeys.includes(key)) issues.push({ key, problem: `Missing required key: ${key}` });
        }
      }
      // Also check against .env.example
      const examplePath = join(root, ".env.example");
      if (existsSync(examplePath)) {
        const exampleKeys = readFileSync(examplePath, "utf-8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("=")[0].trim()).filter(Boolean);
        const envSet = new Set(envKeys);
        for (const k of exampleKeys) {
          if (!envSet.has(k)) issues.push({ key: k, problem: `In .env.example but missing from .env` });
        }
      }
      // Check for common issues
      if (envContent.includes("secret=") || envContent.includes("password=") || envContent.includes("api_key="))
        issues.push({ key: "secrets", problem: "Potential placeholder secrets in .env" });
      return { valid: issues.length === 0, issues };
    },
  },
};

// ─── 2. Dependency Vulnerability Scanner ──────────────────────────────
export const dependencyVulnerabilityScanner: ToolEntry = {
  name: "dependency-vulnerability-scanner",
  tool: {
    description: "Reads package.json and checks for outdated/pinned deps",
    inputSchema: { type: "object", properties: {} },
    handler: async (args, root) => {
      const pkgPath = join(root, "package.json");
      if (!existsSync(pkgPath)) return { dependencies: [], message: "package.json not found" };
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
      const deps: Array<{ name: string; version: string; pinned: boolean; risk: "low" | "medium" | "high" }> = [];
      for (const [name, version] of Object.entries(allDeps)) {
        const v = String(version);
        const pinned = /^\d+\.\d+\.\d+$/.test(v) || /^[a-f0-9]{40}$/.test(v);
        let risk: "low" | "medium" | "high" = "low";
        if (v.startsWith("*")) risk = "high";
        else if (v.startsWith("~")) risk = "medium";
        else if (!pinned) risk = "medium";
        deps.push({ name, version: v, pinned, risk });
      }
      return { dependencies: deps };
    },
  },
};

// ─── 3. Architecture Diagram Sync ──────────────────────────────────────
export const architectureDiagramSync: ToolEntry = {
  name: "architecture-diagram-sync",
  tool: {
    description: "Scans source directories and generates a Mermaid.js architecture diagram",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = args.directory ? join(root, args.directory as string) : root;
      const srcDir = join(dir, "src");
      const targetDir = existsSync(srcDir) ? srcDir : dir;
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const subgraphs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules");
      let mermaid = "graph TD\n";
      mermaid += `  Root["${requireProjectName(dir)}"]\n`;
      for (const sg of subgraphs) {
        const label = sg.name.replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
        mermaid += `  subgraph ${sg.name}["${label}"]\n`;
        const subDir = join(targetDir, sg.name);
        const sub = readdirSync(subDir, { withFileTypes: true });
        const files = sub.filter((e) => e.isFile()).map((e) => e.name.replace(/\.(ts|tsx|js|jsx)$/, ""));
        for (const f of files.slice(0, 10)) {
          mermaid += `    ${sg.name}_${f.replace(/[^a-zA-Z0-9]/g, "_")}["${f}"]\n`;
        }
        mermaid += `  end\n`;
      }
      return { mermaid };
    },
  },
};

function requireProjectName(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    return pkg.name || "coder-workflow";
  } catch {
    return "Project";
  }
}
