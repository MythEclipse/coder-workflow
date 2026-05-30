import fs from "node:fs";
import path from "node:path";

export interface WorkspaceResolutionContext {
  packages: Map<string, string>;
  pathAliases: Array<{ prefix: string; targets: string[] }>;
  baseUrl: string;
}

export function loadWorkspaceResolutionContext(root: string): WorkspaceResolutionContext {
  return {
    packages: loadWorkspacePackages(root),
    pathAliases: loadTsconfigAliases(root),
    baseUrl: root,
  };
}

function loadWorkspacePackages(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const packageJsonPath = path.join(root, "package.json");
  if (!fs.existsSync(packageJsonPath)) return result;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (!Array.isArray(workspaces)) return result;

    for (const pattern of workspaces) {
      const base = pattern.replace(/\/\*.*$/, "");
      const dir = path.join(root, base);
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        const manifest = path.join(dir, entry, "package.json");
        if (!fs.existsSync(manifest)) continue;
        try {
          const workspacePkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
          if (typeof workspacePkg.name === "string") {
            result.set(workspacePkg.name, path.join(dir, entry));
          }
        } catch {
          // Skip malformed workspace package.json
        }
      }
    }
  } catch {
    // Return empty map on parse error
  }

  return result;
}

function loadTsconfigAliases(root: string): Array<{ prefix: string; targets: string[] }> {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const configPath = path.join(root, name);
    if (!fs.existsSync(configPath)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const paths = config.compilerOptions?.paths;
      if (!paths || typeof paths !== "object") return [];
      return Object.entries(paths)
        .map(([key, value]) => ({
          prefix: key.replace(/\*$/, ""),
          targets: Array.isArray(value) ? value.map(String) : [],
        }))
        .filter((alias) => alias.targets.length > 0);
    } catch {
      // Continue to next config file on parse error
    }
  }
  return [];
}
