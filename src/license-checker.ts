#!/usr/bin/env node
/**
 * License Checker
 *
 * Scans dependency licenses and detects incompatibilities.
 * Supports npm (package-lock.json / node_modules) and pip (requirements.txt).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJsonSafe } from "./utils/index.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface LicenseInfo {
  package: string;
  version: string;
  license: string;
  path: string;
}

export interface LicenseConflict {
  package1: string;
  license1: string;
  package2: string;
  license2: string;
  description: string;
}

export interface LicenseReport {
  total: number;
  licenses: Record<string, number>;
  incompatible: LicenseConflict[];
  restrictive: LicenseInfo[];
  unknown: LicenseInfo[];
}

// ─── Known License Categories ────────────────────────────────────────────

export const KNOWN_LICENSES: Record<string, string[]> = {
  permissive: [
    "MIT",
    "Apache-2.0",
    "Apache 2.0",
    "Apache2",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSD-4-Clause",
    "ISC",
    "Unlicense",
    "CC0-1.0",
    "0BSD",
    "WTFPL",
    "Python-2.0",
    "PostgreSQL",
    "Zlib",
    "Unicode-DFS-2016",
    "Unicode-DFS-2015",
  ],
  restrictive: [
    "GPL-2.0-only",
    "GPL-2.0-or-later",
    "GPL-2.0",
    "GPL-3.0-only",
    "GPL-3.0-or-later",
    "GPL-3.0",
    "AGPL-3.0-only",
    "AGPL-3.0-or-later",
    "AGPL-3.0",
    "LGPL-3.0-only",
    "LGPL-3.0-or-later",
    "LGPL-3.0",
    "MPL-2.0",
    "BSL-1.0",
    "EUPL-1.2",
    "CC-BY-NC-4.0",
    "SSPL-1.0",
    "BUSL-1.1",
  ],
  copyleft: [
    "GPL-2.0-only",
    "GPL-2.0-or-later",
    "GPL-2.0",
    "GPL-3.0-only",
    "GPL-3.0-or-later",
    "GPL-3.0",
    "AGPL-3.0-only",
    "AGPL-3.0-or-later",
    "AGPL-3.0",
    "LGPL-2.1-only",
    "LGPL-2.1-or-later",
    "LGPL-2.1",
    "LGPL-3.0-only",
    "LGPL-3.0-or-later",
    "LGPL-3.0",
    "EUPL-1.2",
    "CeCILL-2.1",
  ],
  unknown: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────

const IPC_LICENSE_PATTERN = /^LicenseRef-(.+)/i;
const SPDX_LIKE_PATTERN =
  /^\(?(MIT|Apache-2\.0|BSD-\d-Clause|ISC|GPL|LGPL|AGPL|MPL|CC0|Unlicense)/i;

function classifyLicense(license: string): "permissive" | "restrictive" | "copyleft" | "unknown" {
  const normalized = license?.trim() || "";

  if (!normalized || normalized === "UNKNOWN" || normalized === "UNLICENSED") {
    return "unknown";
  }

  if (KNOWN_LICENSES.copyleft.includes(normalized)) {
    return "copyleft";
  }
  if (KNOWN_LICENSES.restrictive.includes(normalized)) {
    return "restrictive";
  }
  if (KNOWN_LICENSES.permissive.includes(normalized)) {
    return "permissive";
  }

  // Heuristic matching for common patterns
  if (IPC_LICENSE_PATTERN.test(normalized)) {
    return "unknown";
  }
  if (SPDX_LIKE_PATTERN.test(normalized)) {
    if (/GPL|AGPL/.test(normalized)) return "copyleft";
    if (/LGPL|MPL/.test(normalized)) return "restrictive";
    return "permissive";
  }

  return "unknown";
}

function detectIncompatibilities(
  permissivePkgs: LicenseInfo[],
  restrictivePkgs: LicenseInfo[],
  copyleftPkgs: LicenseInfo[],
): LicenseConflict[] {
  const conflicts: LicenseConflict[] = [];

  // Copyleft + permissive → incompatible
  for (const cp of copyleftPkgs) {
    for (const pp of permissivePkgs) {
      if (cp.package === pp.package) continue;
      conflicts.push({
        package1: cp.package,
        license1: cp.license,
        package2: pp.package,
        license2: pp.license,
        description: `Copyleft license "${cp.license}" in "${cp.package}" is incompatible with permissive license "${pp.license}" in "${pp.package}". Mixing copyleft and permissive dependencies can create compliance issues.`,
      });
    }
  }

  // Restrictive + permissive → potential incompatibility
  for (const rp of restrictivePkgs) {
    for (const pp of permissivePkgs) {
      if (rp.package === pp.package) continue;
      conflicts.push({
        package1: rp.package,
        license1: rp.license,
        package2: pp.package,
        license2: pp.license,
        description: `Restrictive license "${rp.license}" in "${rp.package}" combined with permissive "${pp.license}" in "${pp.package}" may cause license compatibility issues.`,
      });
    }
  }

  return conflicts;
}

// ─── NPM License Scanner ────────────────────────────────────────────────

function extractLicenseField(pkg: Record<string, unknown>): string {
  const license = pkg.license;
  if (typeof license === "string") {
    return license;
  }
  if (license && typeof license === "object" && license !== null) {
    const licObj = license as Record<string, unknown>;
    if (typeof licObj.type === "string") {
      return licObj.type;
    }
  }
  // Check licenses array (SPDX 2.0+ style)
  const licenses = pkg.licenses;
  if (Array.isArray(licenses) && licenses.length > 0) {
    const first = licenses[0] as Record<string, unknown>;
    if (typeof first.type === "string") {
      return first.type;
    }
  }
  return "UNKNOWN";
}

function scanNpmLockFile(lockPath: string, root: string): LicenseInfo[] {
  const lock = readJsonSafe(lockPath);
  if (!lock) return [];

  const results: LicenseInfo[] = [];
  const seen = new Set<string>();

  // npm lockfile v2/v3 (packages key) or v1 (dependencies key)
  const packages = (lock.packages as Record<string, unknown>) || {};
  const dependencies = (lock.dependencies as Record<string, unknown>) || {};

  const allDeps = { ...packages, ...dependencies };

  for (const [depPath, depInfo] of Object.entries(allDeps)) {
    if (depPath === "" || !depInfo || typeof depInfo !== "object") continue;

    const info = depInfo as Record<string, unknown>;
    const name =
      depPath
        .replace(/^node_modules\//, "")
        .split("/")
        .pop() || depPath;
    const version = typeof info.version === "string" ? info.version : "";
    const license = extractLicenseField(info);

    // Resolve actual path where the package lives
    const pkgPath = join(
      root,
      "node_modules",
      depPath.startsWith("node_modules/") ? depPath.slice("node_modules/".length) : depPath,
    );

    // Deduplicate by name+version
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      package: name,
      version,
      license,
      path: pkgPath,
    });
  }

  return results;
}

function scanNpmNodeModules(root: string): LicenseInfo[] {
  const nmPath = join(root, "node_modules");
  if (!existsSync(nmPath)) return [];

  const results: LicenseInfo[] = [];
  const seen = new Set<string>();

  try {
    const dirs = readFileSystemDirs(nmPath);
    for (const dir of dirs) {
      const pkgJsonPath = join(nmPath, dir, "package.json");
      if (!existsSync(pkgJsonPath)) continue;

      const pkg = readJsonSafe(pkgJsonPath);
      if (!pkg) continue;

      const name = typeof pkg.name === "string" ? pkg.name : dir;
      const version = typeof pkg.version === "string" ? pkg.version : "";
      const license = extractLicenseField(pkg);

      const key = `${name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        package: name,
        version,
        license,
        path: join(nmPath, dir),
      });
    }
  } catch {
    // Permission issues on some directories
  }

  return results;
}

function readFileSystemDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

export function scanNpmLicenses(root?: string): LicenseReport {
  const resolvedRoot = root ? resolve(root) : process.cwd();
  const results: LicenseInfo[] = [];

  // Prefer package-lock.json (fast, single file)
  const lockPath = join(resolvedRoot, "package-lock.json");
  const yarnLockPath = join(resolvedRoot, "yarn.lock");
  const pnpmLockPath = join(resolvedRoot, "pnpm-lock.yaml");

  if (existsSync(lockPath)) {
    results.push(...scanNpmLockFile(lockPath, resolvedRoot));
  } else if (existsSync(yarnLockPath) || existsSync(pnpmLockPath)) {
    // Fallback to node_modules scanning for yarn/pnpm
    results.push(...scanNpmNodeModules(resolvedRoot));
  } else {
    // Last resort: scan node_modules
    results.push(...scanNpmNodeModules(resolvedRoot));
  }

  return buildReport(results);
}

// ─── Pip License Scanner ────────────────────────────────────────────────

function parseRequirementsTxt(reqPath: string): string[] {
  try {
    const content = readFileSync(reqPath, "utf-8");
    const lines = content.split("\n");
    return lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("git+"))
      .map((l) => {
        // Strip version specifiers
        const match = l.match(/^([a-zA-Z0-9_.-]+)/);
        return match ? match[1] : l;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// A small mapping of well-known PyPI packages to their common licenses.
// This is intentionally incomplete — it covers the most common packages
// and flags everything else as unknown.
const KNOWN_PIP_LICENSES: Record<string, string> = {
  requests: "Apache-2.0",
  flask: "BSD-3-Clause",
  django: "BSD-3-Clause",
  numpy: "BSD-3-Clause",
  pandas: "BSD-3-Clause",
  scipy: "BSD-3-Clause",
  sqlalchemy: "MIT",
  "sqlalchemy-utils": "MIT",
  celery: "BSD-3-Clause",
  redis: "MIT",
  jinja2: "BSD-3-Clause",
  click: "BSD-3-Clause",
  werkzeug: "BSD-3-Clause",
  itsdangerous: "BSD-3-Clause",
  gunicorn: "MIT",
  uvicorn: "BSD-3-Clause",
  fastapi: "MIT",
  pydantic: "MIT",
  psycopg2: "LGPL-2.1",
  "psycopg2-binary": "LGPL-2.1",
  boto3: "Apache-2.0",
  botocore: "Apache-2.0",
  pytest: "MIT",
  mypy: "MIT",
  black: "MIT",
  isort: "MIT",
  flake8: "MIT",
  pylint: "GPL-2.0",
  tox: "MIT",
  coverage: "Apache-2.0",
  sphinx: "BSD-2-Clause",
  "python-dateutil": "Apache-2.0",
  pytz: "MIT",
  pyyaml: "MIT",
  pillow: "Historical",
  "python-dotenv": "BSD-3-Clause",
  attrs: "MIT",
  urllib3: "MIT",
  certifi: "MPL-2.0",
  chardet: "LGPL-2.1",
  idna: "BSD-3-Clause",
};

export function scanPipLicenses(root?: string): LicenseReport {
  const resolvedRoot = root ? resolve(root) : process.cwd();
  const results: LicenseInfo[] = [];

  // Try requirements.txt
  const reqPath = join(resolvedRoot, "requirements.txt");
  if (existsSync(reqPath)) {
    const pkgNames = parseRequirementsTxt(reqPath);
    for (const name of pkgNames) {
      const license = KNOWN_PIP_LICENSES[name.toLowerCase()] || "UNKNOWN";
      results.push({
        package: name,
        version: "",
        license,
        path: reqPath,
      });
    }
  }

  // Also check requirements/*.txt convention
  const reqDir = join(resolvedRoot, "requirements");
  if (existsSync(reqDir)) {
    try {
      const files = readdirSync(reqDir).filter((f) => f.endsWith(".txt"));
      for (const file of files) {
        const pkgNames = parseRequirementsTxt(join(reqDir, file));
        for (const name of pkgNames) {
          const license = KNOWN_PIP_LICENSES[name.toLowerCase()] || "UNKNOWN";
          // Deduplicate by checking if already added
          if (!results.some((r) => r.package === name)) {
            results.push({
              package: name,
              version: "",
              license,
              path: join(reqDir, file),
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return buildReport(results);
}

// ─── Report Builder ─────────────────────────────────────────────────────

function buildReport(results: LicenseInfo[]): LicenseReport {
  const licenseCounts: Record<string, number> = {};

  for (const info of results) {
    const lic = info.license || "UNKNOWN";
    licenseCounts[lic] = (licenseCounts[lic] || 0) + 1;
  }

  const all = categorizeLicensesRaw(results);

  const report: LicenseReport = {
    total: results.length,
    licenses: licenseCounts,
    incompatible: [],
    restrictive: all.restrictive,
    unknown: all.unknown,
  };

  report.incompatible = detectIncompatibilities(all.permissive, all.restrictive, all.copyleft);

  return report;
}

interface Categorized {
  permissive: LicenseInfo[];
  restrictive: LicenseInfo[];
  copyleft: LicenseInfo[];
  unknown: LicenseInfo[];
}

function categorizeLicensesRaw(results: LicenseInfo[]): Categorized {
  const categorized: Categorized = {
    permissive: [],
    restrictive: [],
    copyleft: [],
    unknown: [],
  };

  for (const info of results) {
    const cat = classifyLicense(info.license);
    categorized[cat].push(info);
  }

  return categorized;
}

export function categorizeLicenses(report: LicenseReport): LicenseReport {
  // The report already has restrictive and unknown populated from buildReport.
  // Recompute incompatible with full categorization.
  // Take the results from restrictive + unknown + reconstruct permissive from license counts
  const allResults: LicenseInfo[] = [...report.restrictive, ...report.unknown];

  // Rebuild permissive/copyleft from the raw data (we don't have it, so re-derive)
  // For the public API, we need to accept a report and add the incompatible field.
  // To do a full recategorize, we would need the original raw data.
  // Since we don't have it, we compute from what we have + flag unknown as permissive for conflict check.
  // This is a best-effort recategorization.

  // Extract permissive from the license counts (inverse of restrictive + unknown)
  const permissivePkgs: LicenseInfo[] = [];
  const copyleftPkgs: LicenseInfo[] = [];

  // We need to look at the license keys: anything not in restrictive/unknown is permissive
  const restrictiveOrUnknown = new Set<string>();
  for (const r of report.restrictive) restrictiveOrUnknown.add(r.license);
  for (const u of report.unknown) restrictiveOrUnknown.add(u.license);

  // Check if any restrictive license is also copyleft
  for (const r of report.restrictive) {
    if (classifyLicense(r.license) === "copyleft") {
      copyleftPkgs.push(r);
    } else {
      permissivePkgs.push(r); // push restrictive under permissive for conflict detection
    }
  }

  report.incompatible = detectIncompatibilities(permissivePkgs, report.restrictive, copyleftPkgs);
  return report;
}

// ─── Formatter ──────────────────────────────────────────────────────────

export function formatLicenseReport(report: LicenseReport): string {
  const lines: string[] = [];
  const divider = "─".repeat(60);

  lines.push("");
  lines.push(`  License Scan Report`);
  lines.push(`  ${divider}`);
  lines.push(`  Total packages scanned: ${report.total}`);
  lines.push("");

  // License breakdown
  lines.push(`  License Distribution:`);
  const sortedLicenses = Object.entries(report.licenses).sort((a, b) => b[1] - a[1]);
  for (const [license, count] of sortedLicenses) {
    const cat = classifyLicense(license);
    const emoji =
      cat === "permissive" ? "🟢" : cat === "restrictive" ? "🟡" : cat === "copyleft" ? "🔴" : "⚪";
    lines.push(`    ${emoji} ${license.padEnd(25)} ${count}`);
  }
  lines.push("");

  // Restrictive packages
  if (report.restrictive.length > 0) {
    lines.push(`  ⚠  Restrictive / Copyleft Packages:`);
    for (const pkg of report.restrictive) {
      const emoji = classifyLicense(pkg.license) === "copyleft" ? "🔴" : "🟡";
      lines.push(`    ${emoji} ${pkg.package}@${pkg.version || "*"} — ${pkg.license}`);
    }
    lines.push("");
  }

  // Unknown licenses
  if (report.unknown.length > 0) {
    lines.push(`  ⚪ Unknown Licenses:`);
    for (const pkg of report.unknown) {
      lines.push(`    ⚪ ${pkg.package}@${pkg.version || "*"} — ${pkg.license}`);
    }
    lines.push("");
  }

  // Incompatibilities
  if (report.incompatible.length > 0) {
    lines.push(`  ❌ License Incompatibilities:`);
    for (const conflict of report.incompatible) {
      lines.push(`    ❌ ${conflict.package1} (${conflict.license1})`);
      lines.push(`       vs ${conflict.package2} (${conflict.license2})`);
      lines.push(`       ${conflict.description}`);
      lines.push("");
    }
  }

  // Summary
  if (
    report.incompatible.length === 0 &&
    report.restrictive.length === 0 &&
    report.unknown.length === 0
  ) {
    lines.push(`  ✅ All licenses are permissive and compatible.`);
  } else {
    lines.push(`  Summary:`);
    if (report.restrictive.length > 0) {
      const copyleftCount = report.restrictive.filter(
        (p) => classifyLicense(p.license) === "copyleft",
      ).length;
      lines.push(`    🟡 Restrictive: ${report.restrictive.length - copyleftCount}`);
      lines.push(`    🔴 Copyleft: ${copyleftCount}`);
    }
    if (report.unknown.length > 0) {
      lines.push(`    ⚪ Unknown: ${report.unknown.length}`);
    }
    if (report.incompatible.length > 0) {
      lines.push(`    ❌ Incompatible pairs: ${report.incompatible.length}`);
    }
  }

  lines.push(`  ${divider}`);
  lines.push("");

  return lines.join("\n");
}
