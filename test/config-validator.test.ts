import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  detectMissingEnvVars,
  formatValidationReport,
  validateEnvFile,
  validateJsonFile,
} from "../src/config-validator.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "config-validator-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("detectMissingEnvVars reports error when file does not exist", () => {
  const report = detectMissingEnvVars(["DATABASE_URL"], "/nonexistent/.env");
  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].key, /file/);
  assert.match(report.errors[0].actual, /not found/);
});

test("detectMissingEnvVars detects missing and empty variables", () => {
  const root = fixture({
    ".env": "DATABASE_URL=postgres://localhost/mydb\nEMPTY_VAR=\n",
  });

  const report = detectMissingEnvVars(
    ["DATABASE_URL", "SECRET_KEY", "EMPTY_VAR"],
    join(root, ".env"),
  );

  assert.equal(report.valid, false);

  const secretKeyErr = report.errors.find((e) => e.key === "SECRET_KEY");
  assert.ok(secretKeyErr);
  assert.match(secretKeyErr!.actual, /missing/);

  const emptyErr = report.errors.find((e) => e.key === "EMPTY_VAR");
  assert.ok(emptyErr);
  assert.match(emptyErr!.actual, /empty/);
});

test("detectMissingEnvVars passes when all vars present and non-empty", () => {
  const root = fixture({
    ".env": "DATABASE_URL=postgres://localhost/mydb\nSECRET_KEY=abc123\n",
  });

  const report = detectMissingEnvVars(
    ["DATABASE_URL", "SECRET_KEY"],
    join(root, ".env"),
  );

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("detectMissingEnvVars handles empty requiredVars list", () => {
  const root = fixture({
    ".env": "DATABASE_URL=postgres://localhost/mydb\n",
  });

  const report = detectMissingEnvVars([], join(root, ".env"));
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("detectMissingEnvVars strips surrounding quotes from values", () => {
  const root = fixture({
    ".env": 'DATABASE_URL="postgres://localhost/mydb"\nSECRET_KEY=\'abc123\'\n',
  });

  const report = detectMissingEnvVars(
    ["DATABASE_URL", "SECRET_KEY"],
    join(root, ".env"),
  );

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("validateEnvFile validates env against schema", () => {
  const root = fixture({
    ".env": "PORT=3000\nDB_URL=https://example.com\nDEBUG=true\nOPTIONAL_VAR=hello\n",
  });

  const report = validateEnvFile(join(root, ".env"), {
    PORT: { type: "number", required: true },
    DB_URL: { type: "url", required: true },
    DEBUG: { type: "boolean", required: true },
    OPTIONAL_VAR: { type: "string", required: false },
  });

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("validateEnvFile detects type mismatches", () => {
  const root = fixture({
    ".env": "PORT=notanumber\nDB_URL=notaurl\nDEBUG=maybe\n",
  });

  const report = validateEnvFile(join(root, ".env"), {
    PORT: { type: "number", required: true },
    DB_URL: { type: "url", required: true },
    DEBUG: { type: "boolean", required: true },
  });

  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 3);
});

test("validateEnvFile reports missing required variable as error", () => {
  const root = fixture({
    ".env": "PORT=3000\n",
  });

  const report = validateEnvFile(join(root, ".env"), {
    PORT: { type: "number", required: true },
    SECRET_KEY: { type: "string", required: true },
  });

  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].key, "SECRET_KEY");
});

test("validateEnvFile reports missing optional variable as warning", () => {
  const root = fixture({
    ".env": "PORT=3000\n",
  });

  const report = validateEnvFile(join(root, ".env"), {
    PORT: { type: "number", required: true },
    OPTIONAL_VAR: { type: "string", required: false },
  });

  assert.equal(report.valid, true);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /optional but missing/);
});

test("validateEnvFile reports file missing error", () => {
  const report = validateEnvFile("/nonexistent/.env", {
    PORT: { type: "number", required: true },
  });

  assert.equal(report.valid, false);
  assert.match(report.errors[0].actual, /not found/);
});

test("validateEnvFile applies pattern validation", () => {
  const root = fixture({
    ".env": "HOST=invalid_host_name\nPORT=3000\n",
  });

  const report = validateEnvFile(join(root, ".env"), {
    HOST: {
      type: "string",
      required: false,
      pattern: "^[a-zA-Z0-9.-]+$",
    },
    PORT: { type: "number", required: true },
  });

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].severity, "warning");
  assert.match(report.errors[0].expected, /match pattern/);
});

test("validateEnvFile handles boolean values true/false and 1/0", () => {
  const root = fixture({
    ".env": "FLAG1=true\nFLAG2=false\nFLAG3=1\nFLAG4=0\n",
  });

  const report = validateEnvFile(join(root, ".env"), {
    FLAG1: { type: "boolean", required: true },
    FLAG2: { type: "boolean", required: true },
    FLAG3: { type: "boolean", required: true },
    FLAG4: { type: "boolean", required: true },
  });

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("validateJsonFile validates JSON file against schema", () => {
  const root = fixture({
    "config.json": JSON.stringify({
      server: { port: 3000, host: "localhost" },
      database: { url: "postgres://localhost/mydb" },
    }),
  });

  const report = validateJsonFile(join(root, "config.json"), {
    "server.port": { type: "number" },
    "server.host": { type: "string" },
    "database.url": { type: "string" },
  });

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("validateJsonFile detects missing required keys", () => {
  const root = fixture({
    "config.json": JSON.stringify({ server: { port: 3000 } }),
  });

  const report = validateJsonFile(join(root, "config.json"), {
    "server.port": { type: "number" },
    "database.url": { type: "string", required: true },
  });

  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].key, "database.url");
});

test("validateJsonFile detects type mismatch with array type", () => {
  const root = fixture({
    "config.json": JSON.stringify({ items: [1, 2, 3] }),
  });

  const report = validateJsonFile(join(root, "config.json"), {
    items: { type: "array" },
  });

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("validateJsonFile type mismatch reports error", () => {
  const root = fixture({
    "config.json": JSON.stringify({ port: "notanumber" }),
  });

  const report = validateJsonFile(join(root, "config.json"), {
    port: { type: "number" },
  });

  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].key, "port");
});

test("validateJsonFile handles invalid JSON gracefully", () => {
  const root = fixture({
    "config.json": "{invalid json}",
  });

  const report = validateJsonFile(join(root, "config.json"), {
    port: { type: "number" },
  });

  assert.equal(report.valid, false);
  assert.match(report.errors[0].key, /parse/);
});

test("validateJsonFile reports missing file", () => {
  const report = validateJsonFile("/nonexistent/config.json", {
    port: { type: "number" },
  });

  assert.equal(report.valid, false);
  assert.match(report.errors[0].actual, /not found/);
});

test("formatValidationReport shows success for no errors or warnings", () => {
  const output = formatValidationReport({
    valid: true,
    errors: [],
    warnings: [],
    filesChecked: 1,
  });
  assert.match(output, /All checks passed/);
});

test("formatValidationReport includes files checked count", () => {
  const output = formatValidationReport({
    valid: true,
    errors: [],
    warnings: [],
    filesChecked: 2,
  });
  assert.match(output, /Files checked: 2/);
});

test("formatValidationReport formats errors and warnings", () => {
  const output = formatValidationReport({
    valid: false,
    errors: [
      {
        key: "PORT",
        expected: "number",
        actual: "abc",
        severity: "error",
      },
    ],
    warnings: ["PORT is optional but missing or empty"],
    filesChecked: 1,
  });

  assert.match(output, /PORT/);
  assert.match(output, /expected number/);
  assert.match(output, /abc/);
  assert.match(output, /optional but missing/);
});

test("formatValidationReport truncates long actual values", () => {
  const longValue = "x".repeat(100);
  const output = formatValidationReport({
    valid: false,
    errors: [
      {
        key: "LONG",
        expected: "short",
        actual: longValue,
        severity: "error",
      },
    ],
    warnings: [],
    filesChecked: 1,
  });

  assert.match(output, new RegExp("x".repeat(77) + "\\.\\.\\."));
});

test("formatValidationReport handles mixed error/warning reports", () => {
  const output = formatValidationReport({
    valid: false,
    errors: [
      {
        key: "REQUIRED_KEY",
        expected: "string",
        actual: "(missing)",
        severity: "error",
      },
    ],
    warnings: ["Optional key is missing"],
    filesChecked: 1,
  });

  assert.match(output, /Errors/);
  assert.match(output, /Warnings/);
  assert.match(output, /REQUIRED_KEY/);
  assert.match(output, /Optional key is missing/);
});

test("validateJsonFile handles non-object root gracefully", () => {
  const root = fixture({
    "config.json": JSON.stringify("just a string"),
  });

  const report = validateJsonFile(join(root, "config.json"), {
    key: { type: "string" },
  });

  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].key, /root/);
});

test("validateEnvFile accepts valid boolean values only", () => {
  const root = fixture({
    ".env": "FLAG=yes\n",
  });

  const report = validateEnvFile(join(root, ".env"), {
    FLAG: { type: "boolean", required: true },
  });

  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 1);
});
