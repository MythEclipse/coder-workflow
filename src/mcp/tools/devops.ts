import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { McpTool } from "./types.js";

export interface ToolEntry {
  name: string;
  tool: McpTool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key) vars[key] = val;
  }
  return vars;
}

function readEnvContent(root: string, envPath?: string): string | null {
  const paths = envPath ? [resolve(root, envPath)] : [join(root, ".env")];
  for (const p of paths) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      continue;
    }
  }
  // Fallback: .env.example
  try {
    return readFileSync(join(root, ".env.example"), "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. environment-secret-validator
// ---------------------------------------------------------------------------

export const environmentSecretValidator: ToolEntry = {
  name: "environment-secret-validator",
  tool: {
    description:
      "Validates .env file against a schema or .env.example for missing / extra keys",
    inputSchema: {
      type: "object",
      properties: {
        envPath: {
          type: "string",
          description: "Custom path to .env file (default: .env in root)",
        },
        schema: {
          type: "object",
          description:
            "Optional schema map of key names to descriptions. Falls back to .env.example",
          additionalProperties: { type: "string" },
        },
      },
    },
    handler: async (
      args: Record<string, unknown>,
      root: string,
    ): Promise<{
      valid: boolean;
      issues: { key: string; problem: string }[];
    }> => {
      const envPath = args.envPath as string | undefined;
      const schema = args.schema as Record<string, string> | undefined;

      const envContent = readEnvContent(root, envPath);
      if (envContent === null) {
        return {
          valid: false,
          issues: [{ key: "__env__", problem: "No .env or .env.example found" }],
        };
      }

      const envVars = parseEnvFile(envContent);

      // Determine schema keys
      let schemaKeys: string[];
      if (schema) {
        schemaKeys = Object.keys(schema);
      } else {
        try {
          const exampleContent = readFileSync(join(root, ".env.example"), "utf-8");
          schemaKeys = Object.keys(parseEnvFile(exampleContent));
        } catch {
          // No schema, no .env.example — everything is "valid" (nothing to check against)
          return { valid: true, issues: [] };
        }
      }

      const issues: { key: string; problem: string }[] = [];
      const envKeySet = new Set(Object.keys(envVars));

      for (const key of schemaKeys) {
        if (!envKeySet.has(key)) {
          issues.push({ key, problem: "missing" });
        }
      }
      for (const key of envKeySet) {
        if (!schemaKeys.includes(key)) {
          issues.push({ key, problem: "extra (not in schema)" });
        }
      }

      return { valid: issues.length === 0, issues };
    },
  },
};

// ---------------------------------------------------------------------------
// 2. dependency-vulnerability-scanner
// ---------------------------------------------------------------------------

export const dependencyVulnerabilityScanner: ToolEntry = {
  name: "dependency-vulnerability-scanner",
  tool: {
    description:
      "Reads package.json and reports dependency pinning status (simulated vulnerability check)",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (
      _args: Record<string, unknown>,
      root: string,
    ): Promise<{
      dependencies: {
        name: string;
        version: string;
        pinned: boolean;
        risk: "low" | "medium" | "high";
      }[];
    }> => {
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
      } catch {
        return { dependencies: [] };
      }

      const allDeps: Record<string, string> = {
        ...(pkg.dependencies as Record<string, string> | undefined),
        ...(pkg.devDependencies as Record<string, string> | undefined),
      };

      const results: {
        name: string;
        version: string;
        pinned: boolean;
        risk: "low" | "medium" | "high";
      }[] = [];

      for (const [name, rawVersion] of Object.entries(allDeps)) {
        const version = String(rawVersion);
        const pinned = !/^[\^~>=<\*]/.test(version);

        let risk: "low" | "medium" | "high";
        if (pinned) {
          risk = "low";
        } else if (version.startsWith("~")) {
          risk = "medium";
        } else {
          risk = "high";
        }

        results.push({ name, version, pinned, risk });
      }

      return { dependencies: results };
    },
  },
};

// ---------------------------------------------------------------------------
// 3. architecture-diagram-sync
// ---------------------------------------------------------------------------

function sanitizeId(label: string): string {
  return label.replace(/[^a-zA-Z0-9_]/g, "_");
}

export const architectureDiagramSync: ToolEntry = {
  name: "architecture-diagram-sync",
  tool: {
    description:
      "Scans source directories and generates a Mermaid.js architecture diagram",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Root directory to scan (default: src)",
        },
      },
    },
    handler: async (
      args: Record<string, unknown>,
      root: string,
    ): Promise<{ mermaid: string }> => {
      const targetDir = resolve(root, (args.directory as string) || "src");

      let entries: string[];
      try {
        entries = readdirSync(targetDir);
      } catch {
        return {
          mermaid: "graph TD\n  NotFound[\"Source directory not found\"]",
        };
      }

      const topLevels = entries.filter((e) => {
        try { return statSync(join(targetDir, e)).isDirectory(); } catch { return false; }
      });

      // Collect all directories recursively (max 5 levels)
      const allDirs = [...topLevels.map((d) => join(targetDir, d))];
      function collectDirs(dir: string, depth: number) {
        if (depth > 5) return;
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name);
            if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
              allDirs.push(full);
              collectDirs(full, depth + 1);
            }
          }
        } catch { /* skip unreadable */ }
      }
      for (const d of topLevels) collectDirs(join(targetDir, d), 0);

      if (allDirs.length === 0) {
        return { mermaid: "graph TD\n  Empty[\"No subdirectories found\"]" };
      }

      const lines: string[] = ["graph TD"];

      for (const subPath of allDirs.sort()) {
        const subdir = relative(targetDir, subPath);
        lines.push(`  subgraph ${sanitizeId(subdir)}["${subdir}"]`);

        let fileNames: string[] = [];
        try {
          fileNames = readdirSync(subPath)
            .filter((f) => /\.(ts|js|tsx|jsx)$/.test(f))
            .map((f) => f.replace(/\.(ts|js|tsx|jsx)$/, ""));
        } catch {
          // permission issue or similar — treat as empty
        }

        if (fileNames.length === 0) {
          lines.push(`    ${sanitizeId(subdir)}_empty["(empty)"]`);
        } else {
          for (const file of fileNames.sort()) {
            const nodeId = sanitizeId(`${subdir}_${file}`);
            lines.push(`    ${nodeId}["${file}"]`);
          }
        }

        lines.push("  end");
      }

      return { mermaid: lines.join("\n") };
    },
  },
};
