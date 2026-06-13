import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PluginSettings {
  maxDepth: number;
  uiPort: number;
}

export const defaultSettings: PluginSettings = {
  maxDepth: 4,
  uiPort: Number(process.env.CODEGRAPH_DEFAULT_UI_PORT ?? 3737),
};

export function loadSettings(root: string): PluginSettings {
  const path = join(root, ".claude", "coder-workflow.local.md");
  if (!existsSync(path)) return defaultSettings;

  const raw = readFileSync(path, "utf8");
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/m)?.[1];
  if (!frontmatter) return defaultSettings;

  return {
    ...defaultSettings,
    maxDepth: readNumber(frontmatter, "maxDepth") ?? defaultSettings.maxDepth,
    uiPort: readNumber(frontmatter, "uiPort") ?? defaultSettings.uiPort,
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
