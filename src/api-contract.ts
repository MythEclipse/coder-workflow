#!/usr/bin/env node
/**
 * API Contract Testing — Diff OpenAPI specs and detect breaking changes
 * between two versions of an API specification.
 *
 * Uses simple object comparison with no external OpenAPI parsers.
 * Compares path+method keys across specs and reports structural differences.
 */

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ApiContractChange {
  type:
    | "endpoint-removed"
    | "endpoint-added"
    | "schema-changed"
    | "param-removed"
    | "response-changed";
  path: string;
  method: string;
  detail: string;
}

export interface ApiContractReport {
  breaking: boolean;
  changes: ApiContractChange[];
  endpointsBefore: number;
  endpointsAfter: number;
}

interface OpenApiDoc {
  paths?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Parse a spec file — supports JSON and basic YAML. */
function parseSpecFile(filePath: string): OpenApiDoc {
  if (!existsSync(filePath)) {
    throw new Error(`Spec file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8").trim();

  if (raw.length === 0) {
    throw new Error(`Spec file is empty: ${filePath}`);
  }

  // Try JSON first
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return JSON.parse(raw) as OpenApiDoc;
    } catch (err) {
      throw new Error(
        `Failed to parse JSON spec: ${filePath}. ${(err as Error).message}`,
      );
    }
  }

  // Fallback: basic YAML parser for OpenAPI structure
  return parseBasicYaml(raw, filePath);
}

/**
 * A minimal YAML-to-object parser that handles the subset of YAML found in
 * OpenAPI specs: mappings, sequences, inline JSON, quoted scalars, and
 * multi-line strings.  Full YAML 1.1+ is not supported; complex specs may
 * need conversion to JSON before use.
 */
function parseBasicYaml(raw: string, filePath: string): OpenApiDoc {
  try {
    const lines = raw.split("\n");
    const root: Record<string, unknown> = {};
    // Stack of { indent, key, parent }
    const stack: Array<{
      indent: number;
      key: string | null;
      parent: Record<string, unknown> | unknown[];
      isArray: boolean;
      lastArrayIndex: number;
    }> = [{ indent: -1, key: null, parent: root, isArray: false, lastArrayIndex: -1 }];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimEnd();

      // Skip empty lines and comments
      if (trimmed.trim() === "" || /^\s*#/.test(trimmed)) continue;

      const indent = line.length - trimmed.length;
      const content = trimmed;

      // --- Document separator ---
      if (content === "---" || content === "...") continue;

      // --- Pop stack back to correct indent level ---
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }

      const current = stack[stack.length - 1];
      const parent = current.parent;

      // --- Sequence entry (starts with "- ") ---
      if (/^\s*-\s/.test(content) || /^\s*-$/.test(content)) {
        const entryContent = content.replace(/^\s*-\s*/, "");
        const entryIndent = indent + 2;

        // If the current parent isn't already an array, make it one
        if (parent && !Array.isArray(parent)) {
          // This shouldn't happen in well-formed YAML, but handle gracefully
          continue;
        }

        const arr = parent as unknown[];
        let entry: unknown;

        if (entryContent === "" || entryContent === "-") {
          // Nested content follows on next lines (multi-line sequence entry)
          // We start as null and the next items populate it
          entry = null;
        } else if (/^["']/.test(entryContent)) {
          entry = parseYamlScalar(entryContent);
        } else if (/^[\d.]+$/.test(entryContent) || entryContent === "true" || entryContent === "false" || entryContent === "null" || entryContent === "~") {
          entry = parseYamlScalar(entryContent);
        } else if (entryContent.includes(":")) {
          // Inline mapping in sequence: - key: value
          const subObj: Record<string, unknown> = {};
          const colonIdx = entryContent.indexOf(":");
          const sk = entryContent.slice(0, colonIdx).trim();
          const sv = entryContent.slice(colonIdx + 1).trim();
          subObj[sk] = sv ? parseYamlScalar(sv) : null;
          entry = subObj;
        } else {
          entry = parseYamlScalar(entryContent);
        }

        arr.push(entry);

        // If entry is null (nested content follows), set up as object
        if (entry === null) {
          const replacement: Record<string, unknown> = {};
          arr[arr.length - 1] = replacement;
          stack.push({
            indent: entryIndent,
            key: null,
            parent: replacement,
            isArray: false,
            lastArrayIndex: -1,
          });
        } else if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
          // Allow nesting under this entry
          stack.push({
            indent: entryIndent,
            key: null,
            parent: entry as Record<string, unknown>,
            isArray: false,
            lastArrayIndex: -1,
          });
        }

        // Track last array index for the parent array
        current.lastArrayIndex = arr.length - 1;

        continue;
      }

      // --- Key-value mapping ---
      const colonMatch = content.match(/^([^:#]+?):\s*(.*)$/);
      if (colonMatch) {
        const key = colonMatch[1].trim();
        const valuePart = colonMatch[2].trim();

        // Handle quoted keys
        const cleanKey = key.replace(/^["']|["']$/g, "");

        if (parent && !Array.isArray(parent)) {
          if (valuePart === "" || valuePart === "|" || valuePart === ">" || valuePart === "|-" || valuePart === ">-" || valuePart === "|+") {
            // Value will follow on indented lines or is null
            parent[cleanKey] = null;
            stack.push({
              indent,
              key: cleanKey,
              parent: parent,
              isArray: false,
              lastArrayIndex: -1,
            });
            // Wait for next iteration to populate
            const newParent: Record<string, unknown> = {};
            parent[cleanKey] = newParent;
            stack[stack.length - 1].parent = newParent;
          } else if (valuePart === "[]") {
            parent[cleanKey] = [];
          } else if (valuePart === "{}") {
            parent[cleanKey] = {};
          } else if (/^["']/.test(valuePart)) {
            parent[cleanKey] = parseYamlScalar(valuePart);
          } else if (valuePart.startsWith("{")) {
            // Inline JSON object
            try {
              parent[cleanKey] = JSON.parse(valuePart);
            } catch {
              parent[cleanKey] = valuePart;
            }
          } else if (valuePart.startsWith("[")) {
            // Inline JSON array
            try {
              parent[cleanKey] = JSON.parse(valuePart);
            } catch {
              parent[cleanKey] = valuePart;
            }
          } else if (/^[\d.]+(e[+-]?\d+)?$/.test(valuePart) || valuePart === "true" || valuePart === "false" || valuePart === "null" || valuePart === "~") {
            parent[cleanKey] = parseYamlScalar(valuePart);
          } else {
            // Could be a reference or plain scalar
            parent[cleanKey] = parseYamlScalar(valuePart);
          }
        }

        // If value is empty (continued on next lines), push for nesting
        // Actually we already handled that above with the stack push for empty values
        continue;
      }

      // --- Compact sequence (e.g. [a, b, c]) or other inline ---
      if (/^\s*[[{]/.test(content)) {
        try {
          const parsed = JSON.parse(content);
          if (parent && !Array.isArray(parent) && current.key) {
            parent[current.key] = parsed;
          } else if (Array.isArray(parent)) {
            parent.push(parsed);
          }
        } catch {
          // Not valid inline JSON, skip
        }
      }
    }

    return root as OpenApiDoc;
  } catch (err) {
    throw new Error(
      `Failed to parse YAML spec: ${filePath}. ${(err as Error).message}`,
    );
  }
}

function parseYamlScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim();

  // Null
  if (trimmed === "null" || trimmed === "~" || trimmed === "") {
    return null;
  }

  // Boolean
  if (trimmed === "true" || trimmed === "True") return true;
  if (trimmed === "false" || trimmed === "False") return false;

  // Number
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== "") {
    // Check it's not a quoted string that happens to be numeric
    return num;
  }

  // Strip surrounding quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/** Normalize an HTTP method to lowercase for consistent comparison. */
function normalizeMethod(method: string): string {
  return method.toLowerCase();
}

/** Extract all path+method entries from a parsed OpenAPI doc. */
function extractEndpoints(
  doc: OpenApiDoc,
): Array<{ path: string; method: string; details: Record<string, unknown> }> {
  const endpoints: Array<{
    path: string;
    method: string;
    details: Record<string, unknown>;
  }> = [];

  const paths = doc.paths ?? {};
  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const [method, details] of Object.entries(
      methods as Record<string, unknown>,
    )) {
      const normalized = normalizeMethod(method);
      if (
        ["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(
          normalized,
        )
      ) {
        endpoints.push({
          path,
          method: normalized,
          details: (details ?? {}) as Record<string, unknown>,
        });
      }
    }
  }

  return endpoints;
}

/** Build a Set key from path+method for fast lookup. */
function endpointKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Compare response schemas for 2xx status codes. */
function detectResponseChanges(
  beforeDetails: Record<string, unknown>,
  afterDetails: Record<string, unknown>,
  path: string,
  method: string,
): ApiContractChange[] {
  const changes: ApiContractChange[] = [];

  const beforeResponses = (beforeDetails.responses ?? {}) as Record<
    string,
    unknown
  >;
  const afterResponses = (afterDetails.responses ?? {}) as Record<
    string,
    unknown
  >;

  const successCodes = ["200", "201", "default"];

  for (const code of successCodes) {
    const beforeResp = beforeResponses[code] as Record<string, unknown> | undefined;
    const afterResp = afterResponses[code] as Record<string, unknown> | undefined;

    if (beforeResp && !afterResp) {
      changes.push({
        type: "response-changed",
        path,
        method,
        detail: `Response ${code} was removed`,
      });
    } else if (beforeResp && afterResp) {
      const beforeSchema = resolveSchemaRef(beforeResp.content ?? beforeResp);
      const afterSchema = resolveSchemaRef(afterResp.content ?? afterResp);

      if (beforeSchema && afterSchema && !schemasMatch(beforeSchema, afterSchema)) {
        changes.push({
          type: "response-changed",
          path,
          method,
          detail: `Response ${code} schema changed`,
        });
      }
    }
  }

  return changes;
}

/** Compare parameters between two endpoint definitions. */
function detectParamChanges(
  beforeDetails: Record<string, unknown>,
  afterDetails: Record<string, unknown>,
  path: string,
  method: string,
): ApiContractChange[] {
  const changes: ApiContractChange[] = [];

  const beforeParams = extractParams(beforeDetails);
  const afterParams = extractParams(afterDetails);

  const beforeParamKeys = new Set(
    beforeParams.map((p) => `${p.in}:${p.name}`),
  );
  const afterParamKeys = new Set(afterParams.map((p) => `${p.in}:${p.name}`));

  for (const param of beforeParams) {
    const key = `${param.in}:${param.name}`;
    if (!afterParamKeys.has(key)) {
      // Check if it was required — removing required params is breaking
      const detail = param.required
        ? `Required parameter '${param.name}' (${param.in}) was removed`
        : `Optional parameter '${param.name}' (${param.in}) was removed`;
      changes.push({
        type: "param-removed",
        path,
        method,
        detail,
      });
    }
  }

  // Check for new required params — these could also be breaking
  for (const param of afterParams) {
    const key = `${param.in}:${param.name}`;
    if (!beforeParamKeys.has(key) && param.required) {
      changes.push({
        type: "param-removed",
        path,
        method,
        detail: `New required parameter '${param.name}' (${param.in}) was added`,
      });
    }
  }

  return changes;
}

interface ParamInfo {
  name: string;
  in: string;
  required: boolean;
}

function extractParams(details: Record<string, unknown>): ParamInfo[] {
  const params = (details.parameters ?? []) as Array<Record<string, unknown>>;
  return params.map((p) => ({
    name: String(p.name ?? ""),
    in: String(p.in ?? "query"),
    required: p.required === true,
  }));
}

/** Resolve a $ref if present, otherwise return the object as-is. */
function resolveSchemaRef(
  obj: unknown,
): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;

  // If there's a schema property with $ref, we note the ref but
  // can't dereference without the full spec — just flag it as changed
  if (record.schema) return record.schema as Record<string, unknown>;
  if (record["$ref"]) return record as Record<string, unknown>;

  return record;
}

/** Simple structural comparison of two schema-like objects. */
function schemasMatch(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aType = a.type ?? typeof a;
  const bType = b.type ?? typeof b;
  if (aType !== bType) return false;
  if (a["$ref"] !== b["$ref"]) return false;

  // Compare properties recursively
  const aProps = (a.properties ?? {}) as Record<string, unknown>;
  const bProps = (b.properties ?? {}) as Record<string, unknown>;
  const aKeys = Object.keys(aProps);
  const bKeys = Object.keys(bProps);

  // Only flag if keys differ significantly (added keys are non-breaking)
  const removedKeys = aKeys.filter((k) => !(k in bProps));
  if (removedKeys.length > 0) return false;

  // Check type changes in existing properties
  for (const key of aKeys) {
    if (!(key in bProps)) continue;
    const aVal = aProps[key];
    const bVal = bProps[key];
    if (typeof aVal !== typeof bVal) return false;
    if (
      typeof aVal === "object" &&
      aVal !== null &&
      bVal !== null &&
      typeof bVal === "object"
    ) {
      const aObj = aVal as Record<string, unknown>;
      const bObj = bVal as Record<string, unknown>;
      if (aObj.type !== bObj.type) return false;
    }
  }

  // Check required array changes
  const aRequired = (a.required ?? []) as string[];
  const bRequired = (b.required ?? []) as string[];
  const removedRequired = aRequired.filter((r) => !bRequired.includes(r));
  if (removedRequired.length > 0) return false;

  return true;
}

// ─── Core API ────────────────────────────────────────────────────────────

/**
 * Compare two OpenAPI spec files and produce a structured contract report.
 *
 * @param beforePath Path to the older version of the spec (JSON or YAML).
 * @param afterPath  Path to the newer version of the spec (JSON or YAML).
 * @returns An ApiContractReport with detected changes and breaking status.
 */
export function compareOpenApiSpecs(
  beforePath: string,
  afterPath: string,
): ApiContractReport {
  const beforeDoc = parseSpecFile(beforePath);
  const afterDoc = parseSpecFile(afterPath);

  const beforeEndpoints = extractEndpoints(beforeDoc);
  const afterEndpoints = extractEndpoints(afterDoc);

  const beforeMap = new Map(
    beforeEndpoints.map((e) => [endpointKey(e.path, e.method), e]),
  );
  const afterMap = new Map(
    afterEndpoints.map((e) => [endpointKey(e.path, e.method), e]),
  );

  const changes: ApiContractChange[] = [];

  // Detect removed endpoints (breaking)
  for (const [key, ep] of beforeMap) {
    if (!afterMap.has(key)) {
      changes.push({
        type: "endpoint-removed",
        path: ep.path,
        method: ep.method,
        detail: `Endpoint ${ep.method.toUpperCase()} ${ep.path} was removed`,
      });
    }
  }

  // Detect added endpoints (non-breaking)
  for (const [key, ep] of afterMap) {
    if (!beforeMap.has(key)) {
      changes.push({
        type: "endpoint-added",
        path: ep.path,
        method: ep.method,
        detail: `Endpoint ${ep.method.toUpperCase()} ${ep.path} was added`,
      });
    }
  }

  // Detect changes in shared endpoints
  for (const [key, beforeEp] of beforeMap) {
    const afterEp = afterMap.get(key);
    if (!afterEp) continue;

    const { path, method } = beforeEp;

    // Param changes
    const paramChanges = detectParamChanges(
      beforeEp.details,
      afterEp.details,
      path,
      method,
    );
    changes.push(...paramChanges);

    // Response schema changes
    const responseChanges = detectResponseChanges(
      beforeEp.details,
      afterEp.details,
      path,
      method,
    );
    changes.push(...responseChanges);
  }

  // Determine if breaking
  const breakingTypes: ApiContractChange["type"][] = [
    "endpoint-removed",
    "param-removed",
    "schema-changed",
    "response-changed",
  ];
  const breaking = changes.some((c) => breakingTypes.includes(c.type));

  return {
    breaking,
    changes,
    endpointsBefore: beforeEndpoints.length,
    endpointsAfter: afterEndpoints.length,
  };
}

/**
 * Diff the OpenAPI spec between two git refs (commits, branches, tags).
 *
 * @param ref1 The older git reference (e.g. "HEAD~1", "v1.0.0"). Defaults to "HEAD".
 * @param ref2 The newer git reference (e.g. "HEAD", "main"). Defaults to "HEAD".
 * @returns An ApiContractReport comparing the specs at both refs.
 */
export function diffOpenApiFromGit(
  ref1: string = "HEAD",
  ref2: string = "HEAD",
): ApiContractReport {
  // Locate spec files at each ref
  const specFiles = findSpecFilesInRef(ref2);

  if (specFiles.length === 0) {
    // Try ref1
    const beforeFiles = findSpecFilesInRef(ref1);
    if (beforeFiles.length === 0) {
      return {
        breaking: false,
        changes: [],
        endpointsBefore: 0,
        endpointsAfter: 0,
      };
    }
    // All endpoints were removed
    const beforeDoc = readSpecFromGit(ref1, beforeFiles[0]);
    const beforeEndpoints = extractEndpoints(beforeDoc);
    const changes: ApiContractChange[] = beforeEndpoints.map((ep) => ({
      type: "endpoint-removed" as const,
      path: ep.path,
      method: ep.method,
      detail: `Endpoint ${ep.method.toUpperCase()} ${ep.path} was removed`,
    }));
    return {
      breaking: true,
      changes,
      endpointsBefore: beforeEndpoints.length,
      endpointsAfter: 0,
    };
  }

  // Use the first discovered spec file at ref2
  const specFile = specFiles[0];

  // Read spec from both refs
  let beforeDoc: OpenApiDoc;
  let afterDoc: OpenApiDoc;

  try {
    beforeDoc = readSpecFromGit(ref1, specFile);
  } catch {
    // Spec didn't exist in ref1 — all endpoints are additions
    afterDoc = readSpecFromGit(ref2, specFile);
    const afterEndpoints = extractEndpoints(afterDoc);
    const changes: ApiContractChange[] = afterEndpoints.map((ep) => ({
      type: "endpoint-added" as const,
      path: ep.path,
      method: ep.method,
      detail: `Endpoint ${ep.method.toUpperCase()} ${ep.path} was added`,
    }));
    return {
      breaking: false,
      changes,
      endpointsBefore: 0,
      endpointsAfter: afterEndpoints.length,
    };
  }

  try {
    afterDoc = readSpecFromGit(ref2, specFile);
  } catch (err) {
    throw new Error(
      `Failed to read spec from git ref "${ref2}" for file "${specFile}": ${(err as Error).message}`,
    );
  }

  // Build endpoint maps and produce the report
  const beforeEndpoints = extractEndpoints(beforeDoc);
  const afterEndpoints = extractEndpoints(afterDoc);

  const beforeMap = new Map(
    beforeEndpoints.map((e) => [endpointKey(e.path, e.method), e]),
  );
  const afterMap = new Map(
    afterEndpoints.map((e) => [endpointKey(e.path, e.method), e]),
  );

  const changes: ApiContractChange[] = [];

  for (const [key, ep] of beforeMap) {
    if (!afterMap.has(key)) {
      changes.push({
        type: "endpoint-removed",
        path: ep.path,
        method: ep.method,
        detail: `Endpoint ${ep.method.toUpperCase()} ${ep.path} was removed`,
      });
    }
  }

  for (const [key, ep] of afterMap) {
    if (!beforeMap.has(key)) {
      changes.push({
        type: "endpoint-added",
        path: ep.path,
        method: ep.method,
        detail: `Endpoint ${ep.method.toUpperCase()} ${ep.path} was added`,
      });
    }
  }

  for (const [key, beforeEp] of beforeMap) {
    const afterEp = afterMap.get(key);
    if (!afterEp) continue;
    const { path, method } = beforeEp;

    const paramChanges = detectParamChanges(
      beforeEp.details,
      afterEp.details,
      path,
      method,
    );
    changes.push(...paramChanges);

    const responseChanges = detectResponseChanges(
      beforeEp.details,
      afterEp.details,
      path,
      method,
    );
    changes.push(...responseChanges);
  }

  const breakingTypes: ApiContractChange["type"][] = [
    "endpoint-removed",
    "param-removed",
    "schema-changed",
    "response-changed",
  ];
  const breaking = changes.some((c) => breakingTypes.includes(c.type));

  return {
    breaking,
    changes,
    endpointsBefore: beforeEndpoints.length,
    endpointsAfter: afterEndpoints.length,
  };
}

/**
 * Format an ApiContractReport as a readable Markdown string.
 *
 * @param report The report to format.
 * @returns A formatted Markdown string with icons and structured changes.
 */
export function formatContractReport(report: ApiContractReport): string {
  const lines: string[] = [];

  // Header
  const statusIcon = report.breaking ? "🚨" : "✅";
  const statusLabel = report.breaking ? "BREAKING CHANGES DETECTED" : "No breaking changes";
  lines.push(`# API Contract Report ${statusIcon}`);
  lines.push("");
  lines.push(`**Status:** ${statusLabel}`);
  lines.push(`**Endpoints (before → after):** ${report.endpointsBefore} → ${report.endpointsAfter}`);
  if (report.endpointsBefore > 0) {
    const growth = ((report.endpointsAfter - report.endpointsBefore) / report.endpointsBefore * 100).toFixed(1);
    const sign = report.endpointsAfter >= report.endpointsBefore ? "+" : "";
    lines.push(`**Endpoint change:** ${sign}${growth}%`);
  }
  lines.push(`**Total changes:** ${report.changes.length}`);
  lines.push("");

  // Summary counts by type
  const typeCounts = new Map<string, number>();
  for (const change of report.changes) {
    typeCounts.set(change.type, (typeCounts.get(change.type) ?? 0) + 1);
  }
  lines.push("## Summary");
  lines.push("");
  for (const [type, count] of typeCounts) {
    const icon = type === "endpoint-removed" ? "🗑️" :
      type === "endpoint-added" ? "✨" :
      type === "schema-changed" ? "📦" :
      type === "param-removed" ? "🔧" :
      type === "response-changed" ? "📨" : "❓";
    const label = type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`- ${icon} **${label}:** ${count}`);
  }
  lines.push("");

  // Detail per change
  if (report.changes.length > 0) {
    lines.push("## Changes");
    lines.push("");

    for (let i = 0; i < report.changes.length; i++) {
      const change = report.changes[i];
      const icon = change.type === "endpoint-removed" ? "🗑️" :
        change.type === "endpoint-added" ? "✨" :
        change.type === "schema-changed" ? "📦" :
        change.type === "param-removed" ? "🔧" :
        change.type === "response-changed" ? "📨" : "❓";
      const methodTag = `\`${change.method.toUpperCase()}\``;
      const pathTag = `\`${change.path}\``;
      lines.push(`### ${icon} ${methodTag} ${pathTag}`);
      lines.push("");
      lines.push(`**Type:** ${change.type}`);
      lines.push("");
      lines.push(`**Detail:** ${change.detail}`);
      lines.push("");
    }
  } else {
    lines.push("## Changes");
    lines.push("");
    lines.push("_No changes detected between the two specs._");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Internal Git Helpers ───────────────────────────────────────────────

/** Find candidate OpenAPI spec file paths in a git ref. */
function findSpecFilesInRef(ref: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["ls-tree", "--name-only", "-r", ref, "--", "*.json", "*.yaml", "*.yml"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const files = output.trim().split("\n").filter(Boolean);

    // Filter for OpenAPI-looking files
    return files.filter(
      (f) =>
        f.includes("openapi") ||
        f.includes("swagger") ||
        f.includes("spec") ||
        f.includes("api") ||
        f.includes("contract"),
    );
  } catch {
    return [];
  }
}

/** Read and parse an OpenAPI spec file from a specific git ref. */
function readSpecFromGit(ref: string, filePath: string): OpenApiDoc {
  try {
    const raw = execFileSync(
      "git",
      ["show", `${ref}:${filePath}`],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new Error(`Empty file at ${ref}:${filePath}`);
    }

    // Try JSON
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return JSON.parse(trimmed) as OpenApiDoc;
    }

    // Fallback to basic YAML
    return parseBasicYaml(trimmed, `${ref}:${filePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read spec at "${ref}:${filePath}": ${msg}`);
  }
}
