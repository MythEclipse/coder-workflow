import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanForSecrets, formatSecretsReport } from "../src/secrets.js";
import type { SecretsReport } from "../src/secrets.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-secrets-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

// Source regex: /sk-[A-Za-z0-9]{20,}/g  (no hyphens after sk-)
const OPENAI_KEY = 'sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789012';
// Source regex: /sk-ant-[A-Za-z0-9]{20,}/g
const ANTHROPIC_KEY = 'sk-ant-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789012';

test("scanForSecrets detects OpenAI API key in file", () => {
  const root = fixture({
    "src/config.ts": `const apiKey = "${OPENAI_KEY}";\n`,
  });

  const report = scanForSecrets(root);

  assert.ok(report.totalSecrets >= 1);
  const finding = report.findings.find((f) => f.type === "OpenAI API Key");
  assert.ok(finding);
  assert.equal(finding.severity, "high");
  assert.equal(finding.file, "src/config.ts");
  assert.equal(finding.line, 1);
});

test("scanForSecrets detects Anthropic API key", () => {
  const root = fixture({
    ".env": `ANTHROPIC_API_KEY=${ANTHROPIC_KEY}\n`,
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "Anthropic API Key"));
});

test("scanForSecrets detects AWS Access Key", () => {
  const root = fixture({
    "src/aws.ts": "const key = 'AKIA1234567890ABCDEF';\n",
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "AWS Access Key"));
});

test("scanForSecrets detects AWS Secret Key", () => {
  const root = fixture({
    "src/aws.ts": 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "AWS Secret Key"));
});

test("scanForSecrets detects GitHub token", () => {
  const root = fixture({
    "src/git.ts": 'const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "GitHub Token"));
});

test("scanForSecrets detects RSA private key", () => {
  const root = fixture({
    "keys/id_rsa": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\n",
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "RSA Private Key"));
});

test("scanForSecrets detects SSH private key", () => {
  const root = fixture({
    "keys/id_ed25519": "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA...\n-----END OPENSSH PRIVATE KEY-----\n",
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "SSH Private Key"));
});

test("scanForSecrets detects Slack token", () => {
  const root = fixture({
    "src/slack.ts": `const token = "${["xoxb", "123456789012", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"].join("-")}";\n`,
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "Slack Token"));
});

test("scanForSecrets detects JWT token", () => {
  const root = fixture({
    "src/auth.ts": 'const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dkjfhakjshfksjahfkjashfkjashfkjashf";\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "JWT Token"));
});

test("scanForSecrets detects Stripe live key", () => {
  const root = fixture({
    "src/payment.ts": `const key = "${["sk_live", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_")}";\n`,
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "Stripe Live Key"));
});

test("scanForSecrets detects generic secrets (password, token assignments)", () => {
  const root = fixture({
    "src/db.ts": 'const password = "s3cr3tP@ssw0rd!";\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "Generic Secret"));
});

test("scanForSecrets returns empty report for clean files", () => {
  const root = fixture({
    "src/hello.ts": 'export const greeting = "Hello, world!";\n',
    "src/math.ts": "export function add(a: number, b: number): number { return a + b; }\n",
  });

  const report = scanForSecrets(root);

  assert.equal(report.totalSecrets, 0);
  assert.equal(report.filesWithSecrets, 0);
  assert.ok(report.totalFiles >= 2);
});

test("scanForSecrets ignores node_modules, .git, dist by default", () => {
  const root = fixture({
    "node_modules/pkg/index.js": `const key = "${OPENAI_KEY}";\n`,
    ".git/config": '[remote "origin"]\n\turl = https://github.com/user/repo.git\n',
    "dist/bundle.js": `const apiKey = "${OPENAI_KEY}";\n`,
    "src/app.ts": "export const x = 1;\n",
  });

  const report = scanForSecrets(root);

  assert.equal(report.totalSecrets, 0);
  assert.equal(report.totalFiles, 1); // only src/app.ts is scanned
});

test("scanForSecrets ignores package-lock.json and yarn.lock", () => {
  const root = fixture({
    "package-lock.json": OPENAI_KEY,
    "yarn.lock": "sk-abc",
    "src/app.ts": "export const x = 1;\n",
  });

  const report = scanForSecrets(root);

  // Should only find 0 secrets because the lock files are in ignored paths
  // and src/app.ts has no secrets
  assert.equal(report.totalSecrets, 0);
});

test("scanForSecrets respects severity filter", () => {
  const root = fixture({
    "src/config.ts": [
      `const apiKey = "${OPENAI_KEY}";`,
      'const email = "test@example.com";',
    ].join("\n"),
  });

  const reportAll = scanForSecrets(root);
  assert.equal(reportAll.totalSecrets, 3); // OpenAI API Key (high) + Generic Secret (medium) + Email (low)

  const reportHighOnly = scanForSecrets(root, { severity: "high" });
  assert.equal(reportHighOnly.totalSecrets, 1); // only the API key
  const highTypes = reportHighOnly.findings.map((f) => f.type);
  assert.ok(highTypes.includes("OpenAI API Key"));
  assert.ok(!highTypes.includes("Email Hardcoded"));
});

test("scanForSecrets handles scoped path argument", () => {
  const root = fixture({
    "src/secure.ts": `const key = "${OPENAI_KEY}";\n`,
    "lib/public.ts": "export const greeting = 'hello';\n",
  });

  const report = scanForSecrets(root, { paths: ["src/secure.ts"] });

  assert.equal(report.totalSecrets, 1);
  assert.equal(report.totalFiles, 1);
});

test("scanForSecrets gracefully handles nonexistent path", () => {
  const root = fixture({
    "src/app.ts": "export const x = 1;\n",
  });

  const report = scanForSecrets(root, { paths: ["nonexistent/file.ts"] });

  assert.equal(report.totalSecrets, 0);
  assert.equal(report.totalFiles, 0);
});

test("scanForSecrets truncates long matches in output (over 30 chars)", () => {
  // OPENAI_KEY is 44 chars — the match will be truncated to 15+...+15 = 33 chars
  const root = fixture({
    "src/config.ts": `const key = "${OPENAI_KEY}";\n`,
  });

  const report = scanForSecrets(root);

  assert.ok(report.totalSecrets >= 1);
  const finding = report.findings[0];
  assert.ok(finding);
  assert.ok(finding.match.length <= 33, `match "${finding.match}" should be truncated`);
  assert.ok(finding.match.includes("..."), "truncated match should contain ellipsis");
});

test("scanForSecrets counts bySeverity correctly", () => {
  const root = fixture({
    "src/mixed.ts": [
      `const openai = "${OPENAI_KEY}";`,
      `const slack = "${["xoxb", "123456789012", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"].join("-")}";`,
      'const email = "dev@example.com";',
    ].join("\n"),
  });

  const report = scanForSecrets(root);

  assert.ok(report.bySeverity.high >= 2); // OpenAI + Slack
  assert.ok(report.bySeverity.low >= 1); // email
});

test("scanForSecrets reports filesWithSecrets count", () => {
  const root = fixture({
    "src/a.ts": `const key = "${OPENAI_KEY}";\n`,
    "src/b.ts": `const key = "${ANTHROPIC_KEY}";\n`,
    "src/c.ts": "export const x = 1;\n",
  });

  const report = scanForSecrets(root);

  assert.equal(report.filesWithSecrets, 2);
  assert.equal(report.totalFiles, 3);
});

test("scanForSecrets detects multiple secrets on the same line", () => {
  const root = fixture({
    "src/config.ts": `const a = "${OPENAI_KEY}"; const b = "AKIA1234567890ABCDEF";\n`,
  });

  const report = scanForSecrets(root);

  const types = report.findings.map((f) => f.type);
  assert.ok(types.includes("OpenAI API Key"));
  assert.ok(types.includes("AWS Access Key"));
});

test("scanForSecrets detects PGP private key block", () => {
  const root = fixture({
    "keys/pgp.asc": "-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: BCPG C# v1.6.1.0\n...\n-----END PGP PRIVATE KEY BLOCK-----\n",
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "PGP Private Key"));
});

test("scanForSecrets detects GitLab token", () => {
  const root = fixture({
    "src/ci.ts": 'const token = "glpat-abcdefghijklmnopqrstuvwxyz-1234";\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "GitLab Token"));
});

test("scanForSecrets detects npm token", () => {
  const root = fixture({
    ".npmrc": '//registry.npmjs.org/:_authToken=npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "npm Token"));
});

test("scanForSecrets detects database connection URIs", () => {
  const root = fixture({
    "src/db.ts": 'const uri = "mongodb://admin:password@cluster0.mongodb.net:27017/myapp";\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "MongoDB URI"));
});

test("scanForSecrets detects Slack webhook URL", () => {
  const root = fixture({
    "src/notify.ts": 'const webhook = "https://hooks.slack.com/services/T00/B00/abc123def456xyz789";\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "Slack Webhook"));
});

test("scanForSecrets detects Google API key", () => {
  const root = fixture({
    "src/google.ts": 'const key = "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";\n',
  });

  const report = scanForSecrets(root);

  assert.ok(report.findings.some((f) => f.type === "Google API Key"));
});

test("formatSecretsReport returns clean message when no secrets found", () => {
  const report: SecretsReport = {
    findings: [],
    totalFiles: 5,
    filesWithSecrets: 0,
    totalSecrets: 0,
    bySeverity: { high: 0, medium: 0, low: 0 },
  };

  const output = formatSecretsReport(report);

  assert.match(output, /No secrets found/);
  assert.match(output, /clean scan/);
});

test("formatSecretsReport renders findings with severity grouping", () => {
  const report: SecretsReport = {
    findings: [
      {
        file: "src/config.ts",
        line: 1,
        column: 15,
        type: "OpenAI API Key",
        match: "sk-aBcDeFgHiJ...",
        severity: "high",
        description: "OpenAI API key exposed",
      },
      {
        file: "src/email.ts",
        line: 5,
        column: 10,
        type: "Email Hardcoded",
        match: "dev@example.com",
        severity: "low",
        description: "Email address hardcoded",
      },
    ],
    totalFiles: 2,
    filesWithSecrets: 2,
    totalSecrets: 2,
    bySeverity: { high: 1, medium: 0, low: 1 },
  };

  const output = formatSecretsReport(report);

  assert.match(output, /SECRETS SCANNER REPORT/);
  assert.match(output, /Total secrets:\s+2/);
  assert.match(output, /Files scanned:\s+2/);
  assert.match(output, /Files with leaks:\s+2/);
  assert.match(output, /High severity:\s+1/);
  assert.match(output, /Low severity:\s+1/);
  assert.match(output, /src\/config\.ts:1:15/);
  assert.match(output, /src\/email\.ts:5:10/);
  assert.match(output, /OpenAI API Key/);
  assert.match(output, /Email Hardcoded/);
});

test("formatSecretsReport sorts high severity findings before low", () => {
  const report: SecretsReport = {
    findings: [
      {
        file: "a.ts", line: 1, column: 1, type: "Email Hardcoded",
        match: "a@b.com", severity: "low", description: "Email",
      },
      {
        file: "b.ts", line: 1, column: 1, type: "AWS Access Key",
        match: "AKIA1234...", severity: "high", description: "AWS key",
      },
    ],
    totalFiles: 2,
    filesWithSecrets: 2,
    totalSecrets: 2,
    bySeverity: { high: 1, medium: 0, low: 1 },
  };

  const output = formatSecretsReport(report);

  const highIdx = output.indexOf("AWS Access Key");
  const lowIdx = output.indexOf("Email Hardcoded");
  assert.ok(highIdx < lowIdx, "high severity findings should appear before low severity");
});
