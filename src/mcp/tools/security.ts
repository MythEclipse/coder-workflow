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

// ─── 1. Secret Drift Detector ─────────────────────────────────────────
export const secretDriftDetector: ToolEntry = {
  name: "secret-drift-detector",
  tool: {
    description: "Compares .env file keys between branches or against .env.example",
    inputSchema: { type: "object", properties: { envPath: { type: "string" }, examplePath: { type: "string" } } },
    handler: async (args, root) => {
      const envPath = (args.envPath as string) ? resolve(root, args.envPath as string) : join(root, ".env");
      const examplePath = (args.examplePath as string) ? resolve(root, args.examplePath as string) : join(root, ".env.example");
      const parseKeys = (p: string): string[] => {
        if (!existsSync(p)) return [];
        return readFileSync(p, "utf-8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("=")[0].trim()).filter(Boolean);
      };
      const envKeys = parseKeys(envPath);
      const exampleKeys = parseKeys(examplePath);
      const envSet = new Set(envKeys);
      const exampleSet = new Set(exampleKeys);
      const missing = exampleKeys.filter((k) => !envSet.has(k));
      const extra = envKeys.filter((k) => !exampleSet.has(k));
      const drifted = envKeys.filter((k) => exampleSet.has(k));
      return { missing, extra, drifted };
    },
  },
};

// ─── 2. Third-Party Trust Scorer ───────────────────────────────────────
export const thirdPartyTrustScorer: ToolEntry = {
  name: "third-party-trust-scorer",
  tool: {
    description: "Reads package.json dependencies and categorizes by risk",
    inputSchema: { type: "object", properties: {} },
    handler: async (args, root) => {
      const pkgPath = join(root, "package.json");
      if (!existsSync(pkgPath)) return { dependencies: [], message: "package.json not found" };
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
      const deps: Array<{ name: string; version: string; risk: "low" | "medium" | "high" }> = [];
      for (const [name, version] of Object.entries(allDeps)) {
        let risk: "low" | "medium" | "high" = "low";
        if (typeof version === "string") {
          if (version.startsWith("^") || version.startsWith("~")) risk = "medium";
          if (version === "*" || version.startsWith("latest")) risk = "high";
        }
        deps.push({ name, version: String(version), risk });
      }
      return { dependencies: deps };
    },
  },
};

// ─── 3. Permission Creep Auditor ──────────────────────────────────────
export const permissionCreepAuditor: ToolEntry = {
  name: "permission-creep-auditor",
  tool: {
    description: "Scans for permission/scopes patterns in auth configs or guard files",
    inputSchema: { type: "object", properties: { directory: { type: "string" } } },
    handler: async (args, root) => {
      const dir = resolve(root, (args.directory as string) || root);
      const files = listFiles(dir, (f) => /\.(ts|js|json|yaml|yml|toml)$/.test(f));
      const permMap = new Map<string, string[]>();
      for (const f of files) {
        try {
          const content = readFileSync(f, "utf-8");
          const matches = content.matchAll(/['"](permission|scope|role|can|allow|grant)['"]?\s*[:=]\s*['"]([^'"]+)['"]/gi);
          for (const m of matches) {
            const name = m[2].toLowerCase();
            if (!permMap.has(name)) permMap.set(name, []);
            permMap.get(name)!.push(relative(root, f));
          }
        } catch { /* skip */ }
      }
      const permissions = [...permMap.entries()].map(([name, filesUsing]) => {
        const risk: "low" | "medium" | "high" = filesUsing.length > 10 ? "high" : filesUsing.length > 3 ? "medium" : "low";
        return { name, filesUsing: [...new Set(filesUsing)], risk };
      });
      return { permissions };
    },
  },
};
