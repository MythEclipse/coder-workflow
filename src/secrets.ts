#!/usr/bin/env node
/**
 * Secrets Scanner — Pre-Commit Secret Detection
 *
 * Detects hardcoded API keys, tokens, passwords, private keys
 * before they reach git history.
 *
 * Inspired by: truffleHog, gitleaks, detect-secrets
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────

export interface SecretFinding {
  file: string;
  line: number;
  column: number;
  type: string;
  match: string;
  severity: "high" | "medium" | "low";
  description: string;
}

export interface SecretsReport {
  findings: SecretFinding[];
  totalFiles: number;
  filesWithSecrets: number;
  totalSecrets: number;
  bySeverity: Record<string, number>;
}

// ─── Pattern Definitions ───────────────────────────────────────────────

interface SecretPattern {
  type: string;
  regex: RegExp;
  severity: "high" | "medium" | "low";
  description: string;
}

const PATTERNS: SecretPattern[] = [
  // API Keys — High severity
  {
    type: "OpenAI API Key",
    regex: /sk-[A-Za-z0-9-]{20,}/g,
    severity: "high",
    description: "OpenAI API key exposed",
  },
  {
    type: "Anthropic API Key",
    regex: /sk-ant-[A-Za-z0-9]{20,}/g,
    severity: "high",
    description: "Anthropic API key exposed",
  },
  {
    type: "AWS Access Key",
    regex: /AKIA[0-9A-Z]{16}/g,
    severity: "high",
    description: "AWS Access Key ID exposed",
  },
  {
    type: "AWS Secret Key",
    regex: /aws[_-]?secret[_-]?access[_-]?key[\s"']*[:=][\s"']*[A-Za-z0-9/+]{40}/gi,
    severity: "high",
    description: "AWS Secret Access Key",
  },
  {
    type: "GitHub Token",
    regex: /ghp_[A-Za-z0-9]{36}/g,
    severity: "high",
    description: "GitHub personal access token",
  },
  {
    type: "GitHub App Token",
    regex: /ghs_[A-Za-z0-9]{36}/g,
    severity: "high",
    description: "GitHub App token",
  },
  {
    type: "GitLab Token",
    regex: /glpat-[A-Za-z0-9-]{20,}/g,
    severity: "high",
    description: "GitLab personal access token",
  },
  {
    type: "Google API Key",
    regex: /AIza[0-9A-Za-z\-_]{35}/g,
    severity: "high",
    description: "Google API key exposed",
  },
  {
    type: "Slack Token",
    regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
    severity: "high",
    description: "Slack token exposed",
  },
  {
    type: "JWT Token",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    severity: "high",
    description: "JWT token hardcoded",
  },
  {
    type: "Heroku API Key",
    regex:
      /[hH][eE][rR][oO][kK][uU].*[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g,
    severity: "high",
    description: "Heroku API key",
  },
  {
    type: "Stripe Live Key",
    regex: /sk_live_[0-9a-zA-Z]{24,}/g,
    severity: "high",
    description: "Stripe live secret key",
  },
  {
    type: "npm Token",
    regex: /npm_[A-Za-z0-9]{36}/g,
    severity: "high",
    description: "npm access token",
  },

  // Private Keys — High severity
  {
    type: "RSA Private Key",
    regex: /-----BEGIN\s?RSA\s?PRIVATE\s?KEY-----/g,
    severity: "high",
    description: "RSA private key found",
  },
  {
    type: "SSH Private Key",
    regex: /-----BEGIN\s?(OPENSSH|EC|DSA|ED25519)\s?PRIVATE\s?KEY-----/g,
    severity: "high",
    description: "SSH private key found",
  },
  {
    type: "PGP Private Key",
    regex: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
    severity: "high",
    description: "PGP private key found",
  },

  // Tokens — Medium severity
  {
    type: "Slack Webhook",
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g,
    severity: "medium",
    description: "Slack webhook URL",
  },
  {
    type: "Generic Secret",
    regex:
      /(password|passwd|pwd|secret|token|api[_-]?key)[\s"']*[:=][\s"']*['"][A-Za-z0-9!@#$%^&*()_+\-={}:;,.?]{8,}/gi,
    severity: "medium",
    description: "Possible hardcoded secret",
  },
  {
    type: "MongoDB URI",
    regex: /mongodb(?:\+srv)?:\/\/[^\s]{10,}/g,
    severity: "medium",
    description: "MongoDB connection string",
  },
  {
    type: "PostgreSQL URI",
    regex: /postgres(?:\+ssl)?:\/\/[^\s]{10,}/g,
    severity: "medium",
    description: "PostgreSQL connection string",
  },
  {
    type: "MySQL URI",
    regex: /mysql:\/\/[^\s]{10,}/g,
    severity: "medium",
    description: "MySQL connection string",
  },
  {
    type: "Redis URI",
    regex: /redis:\/\/[^\s]{10,}/g,
    severity: "medium",
    description: "Redis connection string",
  },

  // Low severity
  {
    type: "AWS Region",
    regex: /aws_default_region[\s"']*[:=][\s"']*[a-z]{2}-[a-z]+-\d/gi,
    severity: "low",
    description: "AWS region (check if should be env var)",
  },
  {
    type: "Email Hardcoded",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    severity: "low",
    description: "Email address hardcoded",
  },
];

// ─── Ignored Paths ─────────────────────────────────────────────────────

const IGNORED_PATHS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  ".env.example",
  ".env.sample",
  "*.test.ts",
  "*.spec.ts",
  "*.test.js",
  "*.spec.js",
  "CHANGELOG.md",
  "LICENSE",
  "secrets-scanner.ts", // self-scan will match our own patterns
];

function isIgnored(file: string): boolean {
  return IGNORED_PATHS.some((p) => {
    if (p.endsWith("/")) return file.includes(p);
    if (p.startsWith("*.")) return file.endsWith(p.slice(1));
    return file === p || file.endsWith("/" + p);
  });
}

// ─── Scanner ───────────────────────────────────────────────────────────

export function scanForSecrets(
  root: string,
  options?: { paths?: string[]; severity?: "high" | "medium" | "low" },
): SecretsReport {
  const findings: SecretFinding[] = [];
  let totalFiles = 0;
  const filesWithSecrets = new Set<string>();

  const minSeverityRank = options?.severity ? severityRank(options.severity) : 1; // all (show everything)

  const scanPaths = options?.paths ?? ["."];

  for (const scanPath of scanPaths) {
    const absPath = join(root, scanPath);
    if (!existsSync(absPath)) continue;

    const files = absPath === root ? listFilesRecursive(root) : [absPath];

    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (isIgnored(rel)) continue;
      if (!statSync(file).isFile()) continue;

      totalFiles++;

      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx];

          for (const pattern of PATTERNS) {
            if (severityRank(pattern.severity) < minSeverityRank) continue;

            const matches = line.matchAll(pattern.regex);
            for (const match of matches) {
              const matchText =
                match[0].length > 30
                  ? match[0].slice(0, 15) + "..." + match[0].slice(-15)
                  : match[0];

              findings.push({
                file: rel,
                line: lineIdx + 1,
                column: (match.index ?? 0) + 1,
                type: pattern.type,
                match: matchText,
                severity: pattern.severity,
                description: pattern.description,
              });

              filesWithSecrets.add(rel);
            }
          }
        }
      } catch {
        // binary files — skip
      }
    }
  }

  const bySeverity: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }

  return {
    findings,
    totalFiles,
    filesWithSecrets: filesWithSecrets.size,
    totalSecrets: findings.length,
    bySeverity,
  };
}

function severityRank(s: string): number {
  return s === "high" ? 3 : s === "medium" ? 2 : s === "low" ? 1 : 0;
}

function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      results.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

// ─── Report Formatting ─────────────────────────────────────────────────

export function formatSecretsReport(report: SecretsReport): string {
  if (report.totalSecrets === 0) {
    return "✅ No secrets found — clean scan.";
  }

  const lines = [
    "╔══════════════════════════════════════════════════════════════╗",
    "║  🔒 SECRETS SCANNER REPORT                                  ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    `  Total secrets:    ${report.totalSecrets}`,
    `  Files scanned:    ${report.totalFiles}`,
    `  Files with leaks: ${report.filesWithSecrets}`,
    `  High severity:    ${report.bySeverity.high ?? 0}`,
    `  Medium severity:  ${report.bySeverity.medium ?? 0}`,
    `  Low severity:     ${report.bySeverity.low ?? 0}`,
    "",
    "  ── Findings ──",
    "",
  ];

  // Group by severity
  const sorted = [...report.findings].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
  for (const f of sorted) {
    const icon = f.severity === "high" ? "🔴" : f.severity === "medium" ? "🟡" : "🟢";
    lines.push(`  ${icon} ${f.file}:${f.line}:${f.column}`);
    lines.push(`      ${f.type} — ${f.match}`);
  }

  return lines.join("\n");
}
