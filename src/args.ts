/**
 * Shared argument parsing utilities for CLI and MCP.
 */

import type { QualityGateThreshold } from "./analysis.js";

export function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

export function readNumberArg(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} requires a finite number.`);
  return value;
}

export function readRepeatedStringArg(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    values.push(value);
  }
  return values;
}

export function readFailOnThreshold(args: string[]): QualityGateThreshold | "invalid" | undefined {
  const index = args.indexOf("--fail-on");
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (value === "high" || value === "medium" || value === "low") return value;

  return "invalid";
}

export function readSearchOptions(args: string[]) {
  const pattern = args.find((arg) => !arg.startsWith("--"));
  if (!pattern) throw new Error("Search pattern is required.");

  const knownFlags = new Set([
    "--literal",
    "--case-sensitive",
    "--context",
    "--max-results",
    "--max-file-size",
    "--include",
    "--exclude",
    "--pattern",
  ]);
  for (const arg of args) {
    if (arg.startsWith("--") && !knownFlags.has(arg))
      throw new Error(`Unknown search option: ${arg}`);
  }

  return {
    pattern,
    patterns: readRepeatedStringArg(args, "--pattern"),
    regex: !args.includes("--literal"),
    caseSensitive: args.includes("--case-sensitive"),
    contextLines: readNumberArg(args, "--context"),
    maxResults: readNumberArg(args, "--max-results"),
    maxFileSizeBytes: readNumberArg(args, "--max-file-size"),
    include: readRepeatedStringArg(args, "--include"),
    exclude: readRepeatedStringArg(args, "--exclude"),
  };
}

/**
 * Extract a required string argument from an MCP tool call input.
 * Throws if the value is not a non-empty string.
 */
export function stringArg(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${name} must be a non-empty string.`);
}

/**
 * Extract an optional number argument from an MCP tool call input.
 * Returns undefined if the value is undefined. Throws on non-finite numbers.
 */
export function numberArg(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Search numeric options must be finite numbers.");
}

/**
 * Extract an optional string array argument from an MCP tool call input.
 * Returns empty array if undefined. Throws on invalid types.
 */
export function stringArrayArg(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new Error(`${name} must be an array of strings.`);
}
