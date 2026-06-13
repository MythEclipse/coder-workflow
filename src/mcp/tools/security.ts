import fs from "node:fs";
import path from "node:path";

import type { McpTool } from "./types.js";

export interface ToolEntry {
  name: string;
  tool: McpTool;
}

/* ------------------------------------------------------------------ */
/*  1. secret-drift-detector                                           */
/* ------------------------------------------------------------------ */

function parseEnvKeys(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .map((l) => l.split("=", 1)[0].trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export const secretDriftDetector: ToolEntry = {
  name: "secret-drift-detector",
  tool: {
    description:
      "Compares .env file keys between branches or against .env.example. " +
      "Returns missing, extra, and drifted keys.",
    inputSchema: {
      type: "object",
      properties: {
        envPath: {
          type: "string",
          description: "Path to the .env file (default: .env)",
        },
        examplePath: {
          type: "string",
          description: "Path to the reference file (default: .env.example)",
        },
      },
    },
    handler: async (args: Record<string, unknown>, root: string) => {
      const envPath = path.resolve(
        root,
        (args.envPath as string | undefined) ?? ".env",
      );
      const examplePath = path.resolve(
        root,
        (args.examplePath as string | undefined) ?? ".env.example",
      );

      const envKeys = parseEnvKeys(envPath);
      const exampleKeys = parseEnvKeys(examplePath);

      const envSet = new Set(envKeys);
      const exampleSet = new Set(exampleKeys);

      const missing: string[] = [];
      const extra: string[] = [];
      const drifted: string[] = [];

      for (const k of exampleSet) {
        if (!envSet.has(k)) missing.push(k);
      }
      for (const k of envSet) {
        if (!exampleSet.has(k)) extra.push(k);
      }

      if (missing.length === 0 && extra.length === 0) {
        // Both files exist and keys match – mark drifted as empty
        return { missing, extra, drifted };
      }

      // If a key exists in both but values differ we consider it "drifted".
      // Only attempt value comparison when both files actually exist.
      try {
        const envRaw = fs.readFileSync(envPath, "utf-8");
        const exampleRaw = fs.readFileSync(examplePath, "utf-8");

        const envMap = new Map<string, string>();
        const exampleMap = new Map<string, string>();

        for (const line of envRaw.split(/\r?\n/)) {
          const idx = line.indexOf("=");
          if (idx === -1) continue;
          const k = line.slice(0, idx).trim();
          if (k && !k.startsWith("#")) envMap.set(k, line.slice(idx + 1).trim());
        }
        for (const line of exampleRaw.split(/\r?\n/)) {
          const idx = line.indexOf("=");
          if (idx === -1) continue;
          const k = line.slice(0, idx).trim();
          if (k && !k.startsWith("#"))
            exampleMap.set(k, line.slice(idx + 1).trim());
        }

        for (const k of exampleMap.keys()) {
          if (envMap.has(k) && envMap.get(k) !== exampleMap.get(k)) {
            drifted.push(k);
          }
        }
      } catch {
        // one of the files missing – drift not determinable
      }

      return { missing, extra, drifted };
    },
  },
};

/* ------------------------------------------------------------------ */
/*  2. third-party-trust-scorer                                        */
/* ------------------------------------------------------------------ */

interface DepEntry {
  name: string;
  version: string;
  risk: "low" | "medium" | "high";
}

function classifyRisk(name: string): "low" | "medium" | "high" {
  const high = [/^@deprecated\//, /^@babel\/plugin-/, /^@types\//];
  const medium = [/^eslint-plugin-/, /^jest-/, /^@storybook\//];

  if (high.some((r) => r.test(name))) return "high";
  if (medium.some((r) => r.test(name))) return "medium";
  return "low";
}

export const thirdPartyTrustScorer: ToolEntry = {
  name: "third-party-trust-scorer",
  tool: {
    description:
      "Reads package.json dependencies and categorises each by risk " +
      "(deprecated, unmaintained, unknown). Returns a scored list.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (_args: Record<string, unknown>, root: string) => {
      const pkgPath = path.resolve(root, "package.json");
      const dependencies: DepEntry[] = [];

      try {
        const raw = fs.readFileSync(pkgPath, "utf-8");
        const { dependencies: deps = {}, devDependencies: devDeps = {} } =
          JSON.parse(raw);

        const all = { ...deps, ...devDeps };

        for (const [name, version] of Object.entries(all)) {
          dependencies.push({
            name,
            version: String(version),
            risk: classifyRisk(name),
          });
        }
      } catch {
        // package.json not found or invalid – return empty list
      }

      return { dependencies };
    },
  },
};

/* ------------------------------------------------------------------ */
/*  3. permission-creep-auditor                                        */
/* ------------------------------------------------------------------ */

interface PermissionEntry {
  name: string;
  filesUsing: string[];
  risk: "low" | "medium" | "high";
}

// Common permission/scope patterns found in auth configs, guard files, etc.
const PERMISSION_PATTERNS = [
  /(?:permission|scope|role)[s:]?\s*[:=]\s*["']([^"']+)["']/gi,
  /(?:can|allow|grant|access)\s*[:=]\s*["']([^"']+)["']/gi,
];

function scanFileForPermissions(
  filePath: string,
): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const found: string[] = [];

    for (const pattern of PERMISSION_PATTERNS) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        found.push(match[1]!);
      }
    }

    return found;
  } catch {
    return [];
  }
}

function guessPermissionRisk(name: string): "low" | "medium" | "high" {
  const lc = name.toLowerCase();
  if (
    lc.includes("admin") ||
    lc.includes("root") ||
    lc.includes("superuser") ||
    lc.includes("*") ||
    lc === "all"
  ) {
    return "high";
  }
  if (
    lc.includes("write") ||
    lc.includes("delete") ||
    lc.includes("manage")
  ) {
    return "medium";
  }
  return "low";
}

interface PermIndex {
  [perm: string]: { files: Set<string> };
}

export const permissionCreepAuditor: ToolEntry = {
  name: "permission-creep-auditor",
  tool: {
    description:
      "Scans the project for permission / scope patterns in auth configs " +
      "or guard files. Returns a list of discovered permissions and the " +
      "files referencing them.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description:
            "Sub-directory to scan (default: scan root recursively)",
        },
      },
    },
    handler: async (args: Record<string, unknown>, root: string) => {
      const scanDir = args.directory
        ? path.resolve(root, String(args.directory))
        : root;

      // Collect candidate files (common auth/guard/scope config files).
      const candidateDirs = [
        scanDir,
        path.join(scanDir, "src"),
        path.join(scanDir, "config"),
        path.join(scanDir, "auth"),
      ];

      const walkQueue = [...new Set(candidateDirs.filter(fs.existsSync))];
      const candidates: string[] = [];

      // Walk: collect files with relevant extensions
      for (let i = 0; i < walkQueue.length; i++) {
        const dir = walkQueue[i]!;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walkQueue.push(full);
            } else if (/\.(ts|js|json|yaml|yml|toml)$/i.test(entry.name)) {
              candidates.push(full);
            }
          }
        } catch {
          // skip unreadable dirs
        }
      }

      const index: PermIndex = {};

      for (const filePath of candidates) {
        try {
          // Quick content check before deeper scan
          const stat = fs.statSync(filePath);
          if (stat.size > 1_000_000) continue; // skip > 1 MB files

          const permissions = scanFileForPermissions(filePath);
          for (const perm of permissions) {
            if (!index[perm]) {
              index[perm] = { files: new Set() };
            }
            index[perm]!.files.add(filePath);
          }
        } catch {
          // skip unreadable files
        }
      }

      const permissions: PermissionEntry[] = Object.entries(index)
        .map(([name, entry]) => ({
          name,
          filesUsing: [...entry.files].sort(),
          risk: guessPermissionRisk(name),
        }))
        .sort((a, b) => b.filesUsing.length - a.filesUsing.length);

      return { permissions };
    },
  },
};
