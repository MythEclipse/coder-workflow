import * as fs from 'fs';
import * as path from 'path';

/**
 * Report produced by all config validation functions.
 */
export interface ConfigValidationReport {
  valid: boolean;
  errors: Array<{
    key: string;
    expected: string;
    actual: string;
    severity: 'error' | 'warning';
  }>;
  warnings: string[];
  filesChecked: number;
}

/** Schema entry for validateEnvFile. */
export interface EnvSchemaEntry {
  type: 'string' | 'number' | 'boolean' | 'url';
  required: boolean;
  pattern?: string;
}

/** Schema entry for validateJsonFile / validateYamlFile. */
export interface JsonSchemaEntry {
  type: string;
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptyReport(): ConfigValidationReport {
  return { valid: true, errors: [], warnings: [], filesChecked: 0 };
}

function pushError(
  report: ConfigValidationReport,
  key: string,
  expected: string,
  actual: string,
  severity: 'error' | 'warning',
): void {
  report.errors.push({ key, expected, actual, severity });
  if (severity === 'error') report.valid = false;
}

function loadEnvLines(envPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;

  const text = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateValue(
  key: string,
  value: string | undefined,
  schema: EnvSchemaEntry,
  report: ConfigValidationReport,
): void {
  const actual = value === undefined ? '(missing)' : value;

  if (value === undefined || value === '') {
    if (schema.required) {
      pushError(
        report,
        key,
        `required ${schema.type}`,
        actual,
        'error',
      );
    } else {
      report.warnings.push(`${key} is optional but missing or empty`);
    }
    return;
  }

  // Type validation
  switch (schema.type) {
    case 'number': {
      if (isNaN(Number(value))) {
        pushError(report, key, schema.type, actual, 'error');
      }
      break;
    }
    case 'boolean': {
      const lowered = value.toLowerCase();
      if (!['true', 'false', '1', '0'].includes(lowered)) {
        pushError(report, key, schema.type, actual, 'error');
      }
      break;
    }
    case 'url': {
      if (!isUrl(value)) {
        pushError(report, key, schema.type, actual, 'error');
      }
      break;
    }
    case 'string':
      // Any non-empty string is fine
      break;
  }

  // Pattern validation
  if (schema.pattern) {
    try {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        pushError(
          report,
          key,
          `match pattern ${schema.pattern}`,
          actual,
          'warning',
        );
      }
    } catch {
      report.warnings.push(
        `Invalid regex pattern "${schema.pattern}" for key "${key}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a `.env` file against a schema.
 */
export function validateEnvFile(
  envPath: string,
  schema: Record<string, EnvSchemaEntry>,
): ConfigValidationReport {
  const report = emptyReport();
  report.filesChecked = 1;

  if (!fs.existsSync(envPath)) {
    pushError(report, '(file)', 'existing .env file', 'file not found', 'error');
    return report;
  }

  const vars = loadEnvLines(envPath);

  for (const [key, schemaEntry] of Object.entries(schema)) {
    validateValue(key, vars[key], schemaEntry, report);
  }

  return report;
}

/**
 * Validates a JSON config file against a schema.
 *
 * The schema maps keys to their expected type and optional/required status.
 * Nested keys can be addressed with dot-notation (e.g. `"server.port"`).
 */
export function validateJsonFile(
  jsonPath: string,
  schema: Record<string, JsonSchemaEntry>,
): ConfigValidationReport {
  const report = emptyReport();
  report.filesChecked = 1;

  if (!fs.existsSync(jsonPath)) {
    pushError(report, '(file)', 'existing JSON file', 'file not found', 'error');
    return report;
  }

  let data: unknown;
  let raw: string;
  try {
    raw = fs.readFileSync(jsonPath, 'utf-8');
    data = JSON.parse(raw);
  } catch (err) {
    pushError(
      report,
      '(parse)',
      'valid JSON',
      err instanceof Error ? err.message : String(err),
      'error',
    );
    return report;
  }

  if (typeof data !== 'object' || data === null) {
    pushError(report, '(root)', 'object', String(typeof data), 'error');
    return report;
  }

  const root = data as Record<string, unknown>;

  for (const [key, entry] of Object.entries(schema)) {
    const value = resolveDotPath(root, key);

    if (value === undefined) {
      if (entry.required !== false) {
        pushError(report, key, entry.type, '(missing)', 'error');
      }
      continue;
    }

    const actualType = typeof value;
    // For array type expectations, accept both "array" and "Array"
    const normalizedExpected = entry.type.toLowerCase();
    const normalizedActual =
      actualType === 'object' && Array.isArray(value)
        ? 'array'
        : actualType === 'object' && value === null
          ? 'null'
          : actualType;

    if (
      normalizedActual !== normalizedExpected &&
      !(normalizedExpected === 'array' && Array.isArray(value))
    ) {
      const displayActual = Array.isArray(value) ? 'array' : actualType;
      pushError(report, key, entry.type, displayActual, 'error');
    }
  }

  return report;
}

/**
 * Validates a YAML config file.
 *
 * For now, falls back to JSON.parse so that `.yaml` / `.yml` files that happen
 * to be valid JSON still work. A full YAML parser can be swapped in later.
 */
export function validateYamlFile(
  yamlPath: string,
  schema: Record<string, JsonSchemaEntry>,
): ConfigValidationReport {
  const report = emptyReport();
  report.filesChecked = 1;

  if (!fs.existsSync(yamlPath)) {
    pushError(report, '(file)', 'existing YAML file', 'file not found', 'error');
    return report;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(yamlPath, 'utf-8');
  } catch (err) {
    pushError(
      report,
      '(read)',
      'readable file',
      err instanceof Error ? err.message : String(err),
      'error',
    );
    return report;
  }

  // Try JSON.parse first (covers valid JSON in .yaml files).
  // Future: attempt YAML parse here when a parser is available.
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    pushError(
      report,
      '(parse)',
      'valid YAML or JSON',
      'failed to parse (JSON fallback)',
      'error',
    );
    return report;
  }

  if (typeof data !== 'object' || data === null) {
    pushError(report, '(root)', 'object', String(typeof data), 'error');
    return report;
  }

  const root = data as Record<string, unknown>;

  for (const [key, entry] of Object.entries(schema)) {
    const value = resolveDotPath(root, key);

    if (value === undefined) {
      if (entry.required !== false) {
        pushError(report, key, entry.type, '(missing)', 'error');
      }
      continue;
    }

    const actualType = typeof value;
    const normalizedExpected = entry.type.toLowerCase();
    const normalizedActual =
      actualType === 'object' && Array.isArray(value)
        ? 'array'
        : actualType;

    if (
      normalizedActual !== normalizedExpected &&
      !(normalizedExpected === 'array' && Array.isArray(value))
    ) {
      const displayActual = Array.isArray(value) ? 'array' : actualType;
      pushError(report, key, entry.type, displayActual, 'error');
    }
  }

  return report;
}

/**
 * Detects missing environment variables.
 *
 * Reads an env file line-by-line (default: `.env` in cwd) and checks that every
 * variable listed in `requiredVars` exists and is non-empty in that file.
 */
export function detectMissingEnvVars(
  requiredVars: string[],
  envPath?: string,
): ConfigValidationReport {
  const report = emptyReport();
  const resolvedPath = envPath ?? path.resolve(process.cwd(), '.env');
  report.filesChecked = 1;

  if (!fs.existsSync(resolvedPath)) {
    pushError(report, '(file)', 'existing .env file', 'file not found', 'error');
    return report;
  }

  const vars = loadEnvLines(resolvedPath);

  for (const v of requiredVars) {
    if (!vars[v] || vars[v].trim() === '') {
      pushError(
        report,
        v,
        'non-empty value',
        vars[v] === undefined ? '(missing)' : '(empty)',
        'error',
      );
    }
  }

  return report;
}

/**
 * Formats a `ConfigValidationReport` into a human-readable string.
 */
export function formatValidationReport(report: ConfigValidationReport): string {
  const lines: string[] = [];

  if (report.filesChecked > 0) {
    lines.push(`Files checked: ${report.filesChecked}`);
  }

  if (report.errors.length === 0 && report.warnings.length === 0) {
    lines.push('All checks passed.');
    return lines.join('\n');
  }

  // Errors
  if (report.errors.length > 0) {
    lines.push('');
    lines.push('-- Errors --');
    for (const err of report.errors) {
      const mark = err.severity === 'error' ? '✖' : '⚠';
      const actual = err.actual.length > 80 ? err.actual.slice(0, 77) + '...' : err.actual;
      lines.push(`  ${mark} ${err.key}: expected ${err.expected}, got "${actual}"`);
    }
  }

  // Warnings
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('-- Warnings --');
    for (const w of report.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Resolves a dot-notation path inside a nested object.
 *
 * Example: resolveDotPath({ a: { b: 1 } }, 'a.b') => 1
 */
function resolveDotPath(
  obj: Record<string, unknown>,
  dotted: string,
): unknown {
  const parts = dotted.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return undefined;
  }
  return current;
}
