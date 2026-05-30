import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeGraphSettings } from "./types.js";

export const defaultSettings: CodeGraphSettings = {
  languages: ["javascript", "typescript", "python", "go", "rust", "java", "kotlin"],
  ignorePaths: [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "vendor",
    ".codegraph/cache",
    // Gradle / Android
    ".gradle",
    "generated",
    ".idea",
    "out",
    "captures",
  ],
  updateOnStop: true,
  updateOnEdit: false,
  commitGraphJson: false,
  maxDepth: 4,
  uiPort: Number(process.env.CODEGRAPH_DEFAULT_UI_PORT ?? 3737),
  exports: ["json", "mermaid", "dot", "markdown"],
};

export function loadSettings(root: string): CodeGraphSettings {
  const path = join(root, ".claude", "codegraph-mapper.local.md");
  if (!existsSync(path)) return defaultSettings;

  const raw = readFileSync(path, "utf8");
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/m)?.[1];
  if (!frontmatter) return defaultSettings;

  return {
    ...defaultSettings,
    languages: readList(frontmatter, "languages") ?? defaultSettings.languages,
    ignorePaths: readList(frontmatter, "ignorePaths") ?? defaultSettings.ignorePaths,
    updateOnStop: readBool(frontmatter, "updateOnStop") ?? defaultSettings.updateOnStop,
    updateOnEdit: readBool(frontmatter, "updateOnEdit") ?? defaultSettings.updateOnEdit,
    commitGraphJson: readBool(frontmatter, "commitGraphJson") ?? defaultSettings.commitGraphJson,
    maxDepth: readNumber(frontmatter, "maxDepth") ?? defaultSettings.maxDepth,
    uiPort: readNumber(frontmatter, "uiPort") ?? defaultSettings.uiPort,
    exports: readList(frontmatter, "exports") ?? defaultSettings.exports,
  };
}

function readBool(text: string, key: string): boolean | undefined {
  const value = text.match(new RegExp(`^${key}:\\s*(true|false)`, "m"))?.[1];
  return value === undefined ? undefined : value === "true";
}

function readNumber(text: string, key: string): number | undefined {
  const value = text.match(new RegExp(`^${key}:\\s*(\\d+)`, "m"))?.[1];
  return value === undefined ? undefined : Number(value);
}

function readList(text: string, key: string): string[] | undefined {
  const block = text.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n?)+)`, "m"))?.[1];
  if (block)
    return block
      .split("\n")
      .map((line) => line.trim().replace(/^-\s+/, ""))
      .filter(Boolean);

  const inline = text.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, "m"))?.[1];
  if (!inline) return undefined;
  return inline
    .split(",")
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}
