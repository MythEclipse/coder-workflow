import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ToolInfo {
  name: string;
  version: string | null;
  installed: boolean;
  path: string | null;
  minVersion?: string;
  meetsRequirement?: boolean;
}

export interface EnvInfo {
  node: ToolInfo;
  npm: ToolInfo;
  git: ToolInfo;
  python?: ToolInfo;
  docker?: ToolInfo;
  pnpm?: ToolInfo;
  bun?: ToolInfo;
  go?: ToolInfo;
  rustc?: ToolInfo;
}

export interface DoctorReport {
  environment: EnvInfo;
  project: {
    packageJson: boolean;
    tsconfig: boolean;
    readme: boolean;
    git: boolean;
    dockerCompose: boolean;
    ciConfig: boolean;
    mcpConfig: boolean;
  };
  issues: Array<{
    severity: "error" | "warning" | "info";
    message: string;
    fix?: string;
  }>;
  generatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(file: string, args: string[], timeout = 5000): string | null {
  try {
    return execFileSync(file, args, { encoding: "utf-8", timeout }).trim();
  } catch {
    return null;
  }
}

function findTool(tool: string): string | null {
  const which = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(which, [tool], {
      encoding: "utf-8",
      timeout: 3000,
    })
      .trim()
      .split("\n")[0];
    return out || null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const vA = aParts[i] || 0;
    const vB = bParts[i] || 0;
    if (vA > vB) return 1;
    if (vA < vB) return -1;
  }
  return 0;
}

function meetsMin(version: string | null, min: string): boolean | undefined {
  if (version === null) return undefined;
  return compareVersions(version, min) >= 0;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

export function checkTool(
  tool: string,
  versionArg: string = "--version",
  versionRegex: RegExp = /(\d+\.\d+\.\d+)/,
  minVersion?: string,
): ToolInfo {
  const toolPath = findTool(tool);
  const installed = toolPath !== null;
  let version: string | null = null;

  if (installed) {
    const output = run(tool, [versionArg]);
    if (output) {
      const match = output.match(versionRegex);
      version = match ? match[1] : output.split("\n")[0] || null;
    }
  }

  const info: ToolInfo = { name: tool, version, installed, path: toolPath };
  if (minVersion !== undefined) {
    info.minVersion = minVersion;
    info.meetsRequirement = meetsMin(version, minVersion);
  }
  return info;
}

export function checkEnvironment(): EnvInfo {
  return {
    node: checkTool("node", "--version", /v?(\d+\.\d+\.\d+)/, "18.0.0"),
    npm: checkTool("npm"),
    git: checkTool("git"),
    python: checkTool("python", "--version", /Python\s+(\d+\.\d+\.\d+)/),
    docker: checkTool("docker", "--version", /Docker version\s+(\d+\.\d+\.\d+)/),
    pnpm: checkTool("pnpm"),
    bun: checkTool("bun"),
    go: checkTool("go", "version", /go(\d+\.\d+\.\d+)/),
    rustc: checkTool("rustc", "--version", /(\d+\.\d+\.\d+)/),
  };
}

export function checkProjectHealth(root: string): DoctorReport["project"] {
  return {
    packageJson: existsSync(join(root, "package.json")),
    tsconfig: existsSync(join(root, "tsconfig.json")),
    readme: existsSync(join(root, "README.md")) || existsSync(join(root, "README")),
    git: existsSync(join(root, ".git")),
    dockerCompose:
      existsSync(join(root, "docker-compose.yml")) ||
      existsSync(join(root, "docker-compose.yaml")),
    ciConfig: existsSync(join(root, ".github", "workflows")),
    mcpConfig: existsSync(join(root, ".mcp.json")),
  };
}

export function diagnoseIssues(
  env: EnvInfo,
  project: DoctorReport["project"],
): DoctorReport["issues"] {
  const issues: DoctorReport["issues"] = [];

  // ── Node.js not installed ──────────────────────────────────────────────
  if (!env.node.installed) {
    issues.push({
      severity: "error",
      message: "Node.js is not installed or not found in PATH.",
      fix: "Install Node.js 18+ from https://nodejs.org or via nvm (nvm install 18)",
    });
  } else if (env.node.version && compareVersions(env.node.version, "18.0.0") < 0) {
    issues.push({
      severity: "error",
      message: `Node.js ${env.node.version} is too old. Version 18+ is required.`,
      fix: "Upgrade Node.js via nvm (nvm install 18) or download from https://nodejs.org",
    });
  }

  // ── Git not installed ────────────────────────────────────────────────
  if (!env.git.installed) {
    issues.push({
      severity: "error",
      message: "Git is not installed or not found in PATH.",
      fix: "Install Git from https://git-scm.com/downloads",
    });
  }

  // ── npm not installed (unusual but possible) ──────────────────────────
  if (!env.npm.installed) {
    issues.push({
      severity: "warning",
      message: "npm is not installed or not found in PATH.",
      fix: "npm ships with Node.js — reinstall Node.js from https://nodejs.org",
    });
  }

  // ── No package.json ──────────────────────────────────────────────────
  if (!project.packageJson) {
    issues.push({
      severity: "warning",
      message: "No package.json found in project root.",
      fix: "Run npm init to create one, or verify you are in the correct directory.",
    });
  }

  // ── Docker missing but docker-compose exists ─────────────────────────
  if (!env.docker?.installed && project.dockerCompose) {
    issues.push({
      severity: "warning",
      message: "Docker is not installed but a docker-compose.yml exists.",
      fix: "Install Docker from https://docs.docker.com/get-docker/",
    });
  }

  // ── No .git ──────────────────────────────────────────────────────────
  if (!project.git) {
    issues.push({
      severity: "warning",
      message: "No .git directory found. Project is not under version control.",
      fix: "Run git init to initialize a repository, or clone an existing one.",
    });
  }

  // ── No README ────────────────────────────────────────────────────────
  if (!project.readme) {
    issues.push({
      severity: "info",
      message: "No README.md or README found in project root.",
      fix: "Create a README.md to document the project's purpose and usage.",
    });
  }

  // ── No CI config ─────────────────────────────────────────────────────
  if (!project.ciConfig) {
    issues.push({
      severity: "info",
      message: "No CI configuration found (.github/workflows).",
      fix: "Add a GitHub Actions workflow file under .github/workflows/",
    });
  }

  // ── No tsconfig.json ─────────────────────────────────────────────────
  if (!project.tsconfig) {
    issues.push({
      severity: "info",
      message: "No tsconfig.json found in project root.",
      fix: "Create a tsconfig.json file to configure TypeScript compilation.",
    });
  }

  return issues;
}

export function generateDoctorReport(root?: string): DoctorReport {
  const env = checkEnvironment();
  const project = checkProjectHealth(root ?? process.cwd());
  const issues = diagnoseIssues(env, project);

  return { environment: env, project, issues, generatedAt: new Date().toISOString() };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];

  // ── Header ───────────────────────────────────────────────────────────
  lines.push("");
  lines.push("  ╔═══════════════════════════════════════════════════════╗");
  lines.push("  ║           coder-workflow doctor report              ║");
  lines.push("  ╚═══════════════════════════════════════════════════════╝");
  lines.push(`  Generated: ${report.generatedAt}`);
  lines.push("");

  // ── Environment ─────────────────────────────────────────────────────
  lines.push("  >>> Environment");
  lines.push(`    ${formatToolLine("Node.js", report.environment.node)}`);
  lines.push(`    ${formatToolLine("npm", report.environment.npm)}`);
  lines.push(`    ${formatToolLine("Git", report.environment.git)}`);

  if (report.environment.python) {
    lines.push(`    ${formatToolLine("Python", report.environment.python)}`);
  }
  if (report.environment.docker) {
    lines.push(`    ${formatToolLine("Docker", report.environment.docker)}`);
  }
  if (report.environment.pnpm) {
    lines.push(`    ${formatToolLine("pnpm", report.environment.pnpm)}`);
  }
  if (report.environment.bun) {
    lines.push(`    ${formatToolLine("Bun", report.environment.bun)}`);
  }
  if (report.environment.go) {
    lines.push(`    ${formatToolLine("Go", report.environment.go)}`);
  }
  if (report.environment.rustc) {
    lines.push(`    ${formatToolLine("Rust", report.environment.rustc)}`);
  }
  lines.push("");

  // ── Project ─────────────────────────────────────────────────────────
  lines.push("  >>> Project Files");
  lines.push(`    ${formatCheck(report.project.packageJson)}   package.json`);
  lines.push(`    ${formatCheck(report.project.tsconfig)}    tsconfig.json`);
  lines.push(`    ${formatCheck(report.project.readme)}     README.md`);
  lines.push(`    ${formatCheck(report.project.git)}       .git`);
  lines.push(`    ${formatCheck(report.project.dockerCompose)}  docker-compose.yml`);
  lines.push(`    ${formatCheck(report.project.ciConfig)}  .github/workflows`);
  lines.push(`    ${formatCheck(report.project.mcpConfig)} .mcp.json`);
  lines.push("");

  // ── Issues ──────────────────────────────────────────────────────────
  lines.push("  >>> Issues");
  if (report.issues.length === 0) {
    lines.push("    No issues found -- your environment looks good.");
  } else {
    for (const issue of report.issues) {
      const icon = issue.severity === "error"   ? "x" :
                   issue.severity === "warning" ? "!"  :
                                                   "i";
      const label = issue.severity.toUpperCase();
      lines.push(`    ${icon} [${label}] ${issue.message}`);
      if (issue.fix) {
        lines.push(`        fix: ${issue.fix}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Internal Formatters ─────────────────────────────────────────────────────

function formatToolLine(label: string, tool: ToolInfo): string {
  const icon = formatToolIcon(tool);
  const ver = tool.version ?? "not found";
  const extra =
    tool.minVersion && tool.meetsRequirement === false
      ? ` (minimum: ${tool.minVersion})`
      : "";
  return `${icon} ${label.padEnd(8)} ${ver}${extra}`;
}

function formatToolIcon(tool: ToolInfo): string {
  if (!tool.installed) return "x";
  if (tool.minVersion !== undefined && tool.meetsRequirement === false) return "!";
  return "v";
}

function formatCheck(present: boolean): string {
  return present ? "v" : "x";
}
