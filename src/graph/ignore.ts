import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeGraphSettings } from "../types.js";
import { escapeRegex } from "../utils/index.js";

interface IgnoreRule {
  negated: boolean;
  directoryOnly: boolean;
  regex: RegExp;
}

export function createIgnoreMatcher(
  root: string,
  settings: CodeGraphSettings,
): (relativePath: string, isDirectory: boolean) => boolean {
  const configuredRules = settings.ignorePaths.map(ignorePathToRule);
  const gitignoreRules = readGitignore(root)
    .map(parseGitignoreLine)
    .filter((rule): rule is IgnoreRule => rule !== undefined);

  return (relativePath: string, isDirectory: boolean) => {
    const normalized = relativePath.split("\\").join("/");

    for (const rule of configuredRules) {
      if (rule.regex.test(normalized)) return true;
    }

    let ignored = false;
    for (const rule of gitignoreRules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.regex.test(normalized)) ignored = !rule.negated;
    }

    return ignored;
  };
}

function readGitignore(root: string): string[] {
  const path = join(root, ".gitignore");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/);
}

function ignorePathToRule(path: string): IgnoreRule {
  const normalized = trimSlashes(path);
  return {
    negated: false,
    directoryOnly: true,
    regex: new RegExp(`^${escapeRegex(normalized)}(?:/.*)?$`),
  };
}

function parseGitignoreLine(line: string): IgnoreRule | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;

  const negated = trimmed.startsWith("!");
  const rawPattern = negated ? trimmed.slice(1) : trimmed;
  const directoryOnly = rawPattern.endsWith("/");
  const pattern = trimSlashes(rawPattern);
  if (!pattern) return undefined;

  return {
    negated,
    directoryOnly,
    regex: gitignorePatternToRegex(pattern, directoryOnly),
  };
}

function gitignorePatternToRegex(pattern: string, directoryOnly: boolean): RegExp {
  const escaped = pattern
    .split("**")
    .map((part) => part.split("*").map(escapeRegex).join("[^/]*"))
    .join(".*");
  const prefix = pattern.includes("/") ? "^" : "(^|.*/)";
  const suffix = directoryOnly ? "(?:/.*)?$" : "$";
  return new RegExp(`${prefix}${escaped}${suffix}`);
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
