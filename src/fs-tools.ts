import * as fs from "node:fs";
import * as path from "node:path";

/** Ensures the requested path stays strictly within the root */
export function enforceSafePath(root: string, relPath: string): string {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(root, relPath);

  // Strict prevention against root-sibling paths (e.g. /my/code/project-sibling)
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + path.sep)) {
    throw new Error(`Path ${relPath} attempts to escape the root directory.`);
  }
  return target;
}

export interface TreeOptions {
  maxDepth?: number;
  excludeDirs?: Set<string>;
}

const DEFAULT_EXCLUDES = new Set([".git", "node_modules", ".codegraph", "dist", "build"]);

export function getDirectoryTree(
  root: string,
  relDir: string = ".",
  options?: TreeOptions,
): Record<string, unknown> | string {
  const maxDepth = options?.maxDepth ?? 3;
  const excludeDirs = options?.excludeDirs ?? DEFAULT_EXCLUDES;

  function walk(currentDir: string, currentDepth: number): Record<string, unknown> | string {
    if (currentDepth > maxDepth) return "[MAX DEPTH REACHED]";
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return "[UNREADABLE]";
    }

    const result: Record<string, unknown> = {};
    for (const item of items) {
      if (item.isDirectory()) {
        if (excludeDirs.has(item.name)) continue;
        result[`${item.name}/`] = walk(path.join(currentDir, item.name), currentDepth + 1);
      } else {
        result[item.name] = "file";
      }
    }
    return result;
  }

  const targetPath = enforceSafePath(root, relDir);
  return walk(targetPath, 1);
}

export function readFileContent(
  root: string,
  relPath: string,
  startLine?: number,
  endLine?: number,
): string {
  const targetPath = enforceSafePath(root, relPath);
  let content = fs.readFileSync(targetPath, "utf-8");

  if (startLine !== undefined || endLine !== undefined) {
    const lines = content.split("\n");
    const start = startLine ? Math.max(1, startLine) - 1 : 0;
    const end = endLine ? Math.min(lines.length, endLine) : lines.length;
    content = lines.slice(start, end).join("\n");
  }

  return content;
}
