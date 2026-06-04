import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkProjectHealth,
  diagnoseIssues,
  formatDoctorReport,
} from "../src/doctor.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "doctor-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("formatDoctorReport outputs header with generated timestamp", () => {
  const report = {
    environment: {
      node: {
        name: "node",
        version: "18.0.0",
        installed: true,
        path: "/usr/local/bin/node",
        minVersion: "18.0.0",
        meetsRequirement: true,
      },
      npm: { name: "npm", version: "9.0.0", installed: true, path: "/usr/local/bin/npm" },
      git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
    },
    project: {
      packageJson: true,
      tsconfig: true,
      readme: true,
      git: true,
      dockerCompose: false,
      ciConfig: true,
      mcpConfig: true,
    },
    issues: [],
    generatedAt: "2026-01-15T00:00:00.000Z",
  };

  const output = formatDoctorReport(report);
  assert.match(output, /doctor report/);
  assert.match(output, /2026-01-15/);
  assert.match(output, /No issues found/);
});

test("formatDoctorReport lists all environment tools when present", () => {
  const report = {
    environment: {
      node: { name: "node", version: "20.0.0", installed: true, path: "/usr/local/bin/node", minVersion: "18.0.0", meetsRequirement: true },
      npm: { name: "npm", version: "10.0.0", installed: true, path: "/usr/local/bin/npm" },
      git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
      python: { name: "python", version: "3.11.0", installed: true, path: "/usr/bin/python3" },
      docker: { name: "docker", version: "24.0.0", installed: true, path: "/usr/bin/docker" },
      pnpm: { name: "pnpm", version: "8.0.0", installed: true, path: "/usr/local/bin/pnpm" },
      bun: { name: "bun", version: "1.0.0", installed: true, path: "/usr/local/bin/bun" },
      go: { name: "go", version: "1.21.0", installed: true, path: "/usr/local/bin/go" },
      rustc: { name: "rustc", version: "1.75.0", installed: true, path: "/usr/local/bin/rustc" },
    },
    project: {
      packageJson: true,
      tsconfig: true,
      readme: true,
      git: true,
      dockerCompose: false,
      ciConfig: true,
      mcpConfig: true,
    },
    issues: [],
    generatedAt: new Date().toISOString(),
  };

  const output = formatDoctorReport(report);
  assert.match(output, /Node\.js\s+20\.0\.0/);
  assert.match(output, /npm\s+10\.0\.0/);
  assert.match(output, /Git\s+2\.40\.0/);
  assert.match(output, /Python\s+3\.11\.0/);
  assert.match(output, /Docker\s+24\.0\.0/);
  assert.match(output, /pnpm\s+8\.0\.0/);
  assert.match(output, /Bun\s+1\.0\.0/);
  assert.match(output, /Go\s+1\.21\.0/);
  assert.match(output, /Rust\s+1\.75\.0/);
});

test("formatDoctorReport only shows installed optional tools", () => {
  const report = {
    environment: {
      node: { name: "node", version: "18.0.0", installed: true, path: "/usr/local/bin/node", minVersion: "18.0.0", meetsRequirement: true },
      npm: { name: "npm", version: null, installed: false, path: null },
      git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
    },
    project: {
      packageJson: true, tsconfig: true, readme: true, git: true,
      dockerCompose: false, ciConfig: true, mcpConfig: true,
    },
    issues: [],
    generatedAt: new Date().toISOString(),
  };

  const output = formatDoctorReport(report);
  // npm should still show in the environment section with "not found"
  assert.match(output, /npm/);
});

test("formatDoctorReport shows issues with severity icons", () => {
  const report = {
    environment: {
      node: { name: "node", version: null, installed: false, path: null, minVersion: "18.0.0", meetsRequirement: false },
      npm: { name: "npm", version: null, installed: false, path: null },
      git: { name: "git", version: null, installed: false, path: null },
    },
    project: {
      packageJson: false, tsconfig: false, readme: false, git: false,
      dockerCompose: false, ciConfig: false, mcpConfig: false,
    },
    issues: [
      {
        severity: "error" as const,
        message: "Node.js is not installed or not found in PATH.",
        fix: "Install Node.js 18+ from https://nodejs.org",
      },
      {
        severity: "warning" as const,
        message: "No package.json found in project root.",
        fix: "Run npm init to create one.",
      },
      {
        severity: "info" as const,
        message: "No README.md or README found in project root.",
        fix: "Create a README.md",
      },
    ],
    generatedAt: new Date().toISOString(),
  };

  const output = formatDoctorReport(report);
  assert.match(output, /ERROR\] Node\.js/);
  assert.match(output, /WARNING\] No package.json/);
  assert.match(output, /INFO\] No README/);
  assert.match(output, /Install Node\.js/);
  assert.match(output, /npm init/);
  assert.match(output, /Create a README/);
  assert.match(output, /Issues/);
});

test("formatDoctorReport shows project file checks", () => {
  const report = {
    environment: {
      node: { name: "node", version: "18.0.0", installed: true, path: "/usr/local/bin/node" },
      npm: { name: "npm", version: "9.0.0", installed: true, path: "/usr/local/bin/npm" },
      git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
    },
    project: {
      packageJson: true, tsconfig: false, readme: true, git: false,
      dockerCompose: true, ciConfig: false, mcpConfig: true,
    },
    issues: [],
    generatedAt: new Date().toISOString(),
  };

  const output = formatDoctorReport(report);

  assert.match(output, /package\.json/);
  assert.match(output, /tsconfig\.json/);
  assert.match(output, /README\.md/);
  assert.match(output, /\.git/);
  assert.match(output, /docker-compose\.yml/);
  assert.match(output, /\.github\/workflows/);
  assert.match(output, /\.mcp\.json/);

  // Present items get "v", absent get "x"
  assert.match(output, /v\s+package\.json/);
  assert.match(output, /x\s+tsconfig\.json/);
});

test("checkProjectHealth detects present files", () => {
  const root = fixture({
    "package.json": "{}",
    "tsconfig.json": "{}",
    "README.md": "# Project",
    ".git": "",
    "docker-compose.yml": "",
    ".mcp.json": "{}",
  });
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "steps: []");

  const health = checkProjectHealth(root);
  assert.equal(health.packageJson, true);
  assert.equal(health.tsconfig, true);
  assert.equal(health.readme, true);
  assert.equal(health.git, true);
  assert.equal(health.dockerCompose, true);
  assert.equal(health.ciConfig, true);
  assert.equal(health.mcpConfig, true);
});

test("checkProjectHealth detects absent files", () => {
  const root = fixture({});

  const health = checkProjectHealth(root);
  assert.equal(health.packageJson, false);
  assert.equal(health.tsconfig, false);
  assert.equal(health.readme, false);
  assert.equal(health.git, false);
  assert.equal(health.dockerCompose, false);
  assert.equal(health.ciConfig, false);
  assert.equal(health.mcpConfig, false);
});

test("checkProjectHealth detects README without extension", () => {
  const root = fixture({ README: "# Readme" });

  const health = checkProjectHealth(root);
  assert.equal(health.readme, true);
});

test("checkProjectHealth detects docker-compose.yaml alternative extension", () => {
  const root = fixture({ "docker-compose.yaml": "" });

  const health = checkProjectHealth(root);
  assert.equal(health.dockerCompose, true);
});

test("diagnoseIssues reports node not installed as error", () => {
  const env = {
    node: { name: "node", version: null, installed: false, path: null },
    npm: { name: "npm", version: null, installed: true, path: "/usr/local/bin/npm" },
    git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
  };
  const project = {
    packageJson: true, tsconfig: true, readme: true, git: true,
    dockerCompose: false, ciConfig: true, mcpConfig: true,
  };

  const issues = diagnoseIssues(env, project);
  assert.ok(issues.some((i) => i.message.includes("Node.js is not installed")));
});

test("diagnoseIssues reports old node version as error", () => {
  const env = {
    node: { name: "node", version: "16.0.0", installed: true, path: "/usr/local/bin/node" },
    npm: { name: "npm", version: null, installed: true, path: "/usr/local/bin/npm" },
    git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
  };
  const project = {
    packageJson: true, tsconfig: true, readme: true, git: true,
    dockerCompose: false, ciConfig: true, mcpConfig: true,
  };

  const issues = diagnoseIssues(env, project);
  assert.ok(issues.some((i) => i.message.includes("too old")));
});

test("diagnoseIssues reports git not installed", () => {
  const env = {
    node: { name: "node", version: "18.0.0", installed: true, path: "/usr/local/bin/node" },
    npm: { name: "npm", version: null, installed: true, path: "/usr/local/bin/npm" },
    git: { name: "git", version: null, installed: false, path: null },
  };
  const project = {
    packageJson: true, tsconfig: true, readme: true, git: true,
    dockerCompose: false, ciConfig: true, mcpConfig: true,
  };

  const issues = diagnoseIssues(env, project);
  assert.ok(issues.some((i) => i.message.includes("Git is not installed")));
});

test("diagnoseIssues reports missing package.json", () => {
  const env = {
    node: { name: "node", version: "18.0.0", installed: true, path: "/usr/local/bin/node" },
    npm: { name: "npm", version: null, installed: true, path: "/usr/local/bin/npm" },
    git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
  };
  const project = {
    packageJson: false, tsconfig: true, readme: true, git: true,
    dockerCompose: false, ciConfig: true, mcpConfig: true,
  };

  const issues = diagnoseIssues(env, project);
  assert.ok(issues.some((i) => i.message.includes("No package.json")));
});

test("diagnoseIssues reports missing git directory", () => {
  const env = {
    node: { name: "node", version: "18.0.0", installed: true, path: "/usr/local/bin/node" },
    npm: { name: "npm", version: null, installed: true, path: "/usr/local/bin/npm" },
    git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
  };
  const project = {
    packageJson: true, tsconfig: true, readme: true, git: false,
    dockerCompose: false, ciConfig: true, mcpConfig: true,
  };

  const issues = diagnoseIssues(env, project);
  assert.ok(issues.some((i) => i.message.includes("No .git directory")));
});

test("diagnoseIssues reports docker missing when docker-compose present", () => {
  const env = {
    node: { name: "node", version: "18.0.0", installed: true, path: "/usr/local/bin/node" },
    npm: { name: "npm", version: null, installed: true, path: "/usr/local/bin/npm" },
    git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
    docker: { name: "docker", version: null, installed: false, path: null },
  };
  const project = {
    packageJson: true, tsconfig: true, readme: true, git: true,
    dockerCompose: true, ciConfig: true, mcpConfig: true,
  };

  const issues = diagnoseIssues(env, project);
  assert.ok(issues.some((i) => i.message.includes("Docker is not installed but a docker-compose.yml exists")));
});

test("diagnoseIssues provides info-only suggestions for missing readme/ci/tsconfig", () => {
  const env = {
    node: { name: "node", version: "18.0.0", installed: true, path: "/usr/local/bin/node" },
    npm: { name: "npm", version: null, installed: true, path: "/usr/local/bin/npm" },
    git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
  };
  const project = {
    packageJson: true, tsconfig: false, readme: false, git: true,
    dockerCompose: false, ciConfig: false, mcpConfig: false,
  };

  const issues = diagnoseIssues(env, project);
  assert.ok(issues.some((i) => i.message.includes("No README")));
  assert.ok(issues.some((i) => i.message.includes("No CI configuration")));
  assert.ok(issues.some((i) => i.message.includes("No tsconfig.json")));
});

test("formatDoctorReport shows version requirement warning for tools below minimum", () => {
  const report = {
    environment: {
      node: { name: "node", version: "17.0.0", installed: true, path: "/usr/local/bin/node", minVersion: "18.0.0", meetsRequirement: false },
      npm: { name: "npm", version: "9.0.0", installed: true, path: "/usr/local/bin/npm" },
      git: { name: "git", version: "2.40.0", installed: true, path: "/usr/bin/git" },
    },
    project: {
      packageJson: true, tsconfig: true, readme: true, git: true,
      dockerCompose: false, ciConfig: true, mcpConfig: true,
    },
    issues: [],
    generatedAt: new Date().toISOString(),
  };

  const output = formatDoctorReport(report);
  assert.match(output, /minimum: 18\.0\.0/);
});
