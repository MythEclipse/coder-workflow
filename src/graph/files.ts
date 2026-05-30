import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { CodeGraphSettings } from "../types.js";
import { createIgnoreMatcher } from "./ignore.js";
import { languageForPath } from "./languages.js";

export function listSourceFiles(root: string, settings: CodeGraphSettings): string[] {
  const result: string[] = [];
  const isIgnored = createIgnoreMatcher(root, settings);

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const rel = relative(root, fullPath);
      if (isIgnored(rel, entry.isDirectory())) continue;
      if (entry.isDirectory()) walk(fullPath);
      const language = languageForPath(entry.name);
      if (entry.isFile() && language && settings.languages.includes(language))
        result.push(fullPath);
    }
  };

  walk(root);
  return result;
}
