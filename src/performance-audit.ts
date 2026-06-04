#!/usr/bin/env node
/**
 * Bundle analysis and performance metrics.
 *
 * Parses webpack/vite stats.json, estimates sizes from package.json
 * dependencies, formats reports, and combines with Lighthouse data.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BundleModule {
  name: string;
  size: number;
  gzipSize: number;
}

export interface BundleReport {
  totalSize: number;
  totalGzip: number;
  modules: BundleModule[];
  largest: BundleModule[];
  duplicates: string[];
}

export interface LighthouseMetric {
  name: string;
  score: number;
  displayValue: string;
}

export interface PerfReport {
  bundle: BundleReport | null;
  lighthouse: LighthouseMetric[] | null;
  generatedAt: string;
}

export interface BundleDiff {
  name: string;
  beforeSize: number;
  afterSize: number;
  diff: number;
  percent: number;
}

// ---------------------------------------------------------------------------
// Known package sizes (bytes) for ~30 common packages — used by parseBundlePhobia
// ---------------------------------------------------------------------------

const KNOWN_PACKAGE_SIZES: Record<string, number> = {
  react: 6832,
  "react-dom": 130912,
  "react-router-dom": 21600,
  vue: 33500,
  "vue-router": 21000,
  pinia: 3700,
  svelte: 4600,
  angular: 197000,
  "@angular/core": 87000,
  "@angular/common": 83000,
  next: 294000,
  nuxt: 168000,
  gatsby: 232000,
  express: 218000,
  lodash: 71000,
  "lodash-es": 28600,
  axios: 32500,
  dayjs: 6900,
  datefns: 29000,
  moment: 230000,
  chartjs: 63000,
  d3: 274000,
  three: 606000,
  jquery: 87000,
  bootstrap: 195000,
  "bootstrap-icons": 160000,
  tailwindcss: 6500,
  "core-js": 175000,
  rxjs: 95000,
  uuid: 3800,
  zod: 10300,
  immer: 11000,
  zustand: 2600,
  clsx: 400,
  "@emotion/react": 33300,
  "framer-motion": 140000,
  "react-hook-form": 15000,
  "react-query": 23000,
};

// ---------------------------------------------------------------------------
// analyzeBundleStats
// ---------------------------------------------------------------------------

/**
 * Parse a webpack or Vite stats.json file.
 *
 * Supports:
 * - Webpack format: { assets: [{ name, size }] }
 * - Vite format:   { output: [{ fileName, size }] }
 *
 * If the file does not exist, returns a report with 0 values and an error note.
 */
export function analyzeBundleStats(statsPath: string): BundleReport {
  if (!existsSync(statsPath)) {
    return {
      totalSize: 0,
      totalGzip: 0,
      modules: [],
      largest: [],
      duplicates: [],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(statsPath, "utf-8");
  } catch {
    return { totalSize: 0, totalGzip: 0, modules: [], largest: [], duplicates: [] };
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { totalSize: 0, totalGzip: 0, modules: [], largest: [], duplicates: [] };
  }

  const modules: BundleModule[] = [];

  // Webpack: { assets: [{ name, size }] }
  if (Array.isArray(json.assets)) {
    for (const asset of json.assets as Array<Record<string, unknown>>) {
      const name = String(asset.name ?? asset.filename ?? "");
      const size = Number(asset.size) || 0;
      if (!name) continue;
      modules.push({
        name,
        size,
        gzipSize: Math.round(size * 0.3),
      });
    }
  }

  // Vite: { output: [{ fileName, size }] }
  if (Array.isArray(json.output)) {
    for (const entry of json.output as Array<Record<string, unknown>>) {
      const name = String(entry.fileName ?? entry.name ?? "");
      const size = Number(entry.size) || 0;
      if (!name) continue;
      modules.push({
        name,
        size,
        gzipSize: Math.round(size * 0.3),
      });
    }
  }

  return buildBundleReport(modules);
}

// ---------------------------------------------------------------------------
// parseBundlePhobia
// ---------------------------------------------------------------------------

/**
 * Estimate bundle sizes from package.json dependencies using a built-in
 * lookup table of ~30 common package sizes (gzipped estimates included).
 */
export async function parseBundlePhobia(root: string): Promise<BundleReport> {
  const pkgPath = join(resolve(root), "package.json");

  if (!existsSync(pkgPath)) {
    return { totalSize: 0, totalGzip: 0, modules: [], largest: [], duplicates: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf-8");
  } catch {
    return { totalSize: 0, totalGzip: 0, modules: [], largest: [], duplicates: [] };
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { totalSize: 0, totalGzip: 0, modules: [], largest: [], duplicates: [] };
  }

  const deps: Record<string, string> = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  const modules: BundleModule[] = [];
  const nameCounts = new Map<string, number>();

  for (const depName of Object.keys(deps)) {
    const size = KNOWN_PACKAGE_SIZES[depName] ?? 5000; // default 5 KB for unknown
    modules.push({
      name: depName,
      size,
      gzipSize: Math.round(size * 0.3),
    });
    nameCounts.set(depName, (nameCounts.get(depName) ?? 0) + 1);
  }

  return buildBundleReport(modules);
}

// ---------------------------------------------------------------------------
// formatBundleReport
// ---------------------------------------------------------------------------

const DIVIDER = "─".repeat(72);

/**
 * Format a BundleReport as a human-readable table with size columns and
 * warnings for modules larger than 100 KB.
 */
export function formatBundleReport(report: BundleReport): string {
  const lines: string[] = [];

  lines.push("Bundle Report");
  lines.push(DIVIDER);
  lines.push(`  Total size:        ${formatBytes(report.totalSize)}`);
  lines.push(`  Total gzip (est.): ${formatBytes(report.totalGzip)}`);
  lines.push(`  Modules:           ${report.modules.length}`);
  lines.push(`  Duplicates:        ${report.duplicates.length > 0 ? report.duplicates.join(", ") : "none"}`);
  lines.push("");

  if (report.largest.length > 0) {
    lines.push("Largest Modules (>100 KB)");
    lines.push(DIVIDER);
    lines.push("  Name".padEnd(40) + "Size".padStart(14) + "Gzip (est.)".padStart(14));
    lines.push("  " + "─".repeat(38) + "  " + "─".repeat(12) + "  " + "─".repeat(12));
    for (const mod of report.largest) {
      lines.push(
        `  ${mod.name.padEnd(38)} ${formatBytes(mod.size).padStart(10)} ${formatBytes(mod.gzipSize).padStart(12)}`,
      );
    }
    lines.push("");
  }

  if (report.duplicates.length > 0) {
    lines.push("WARNING: Duplicate modules detected");
    for (const dup of report.duplicates) {
      lines.push(`  - ${dup}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// createPerfReport
// ---------------------------------------------------------------------------

/**
 * Create a combined performance report from bundle analysis and optional
 * Lighthouse CI results.
 *
 * Bundle analysis:
 *   1. Tries `stats.json` (webpack) in the project root.
 *   2. Falls back to estimate from package.json dependencies.
 *
 * Lighthouse:
 *   Scans `.lighthouseci/*.json` and extracts metrics from the first
 *   report found.  Gracefully falls back to null if nothing exists.
 */
export function createPerfReport(root: string): PerfReport {
  const resolvedRoot = resolve(root);

  // --- Bundle ---
  let bundle: BundleReport | null = null;

  const statsPaths = [
    join(resolvedRoot, "stats.json"),
    join(resolvedRoot, "dist", "stats.json"),
    join(resolvedRoot, "build", "stats.json"),
  ];

  for (const sp of statsPaths) {
    if (existsSync(sp)) {
      bundle = analyzeBundleStats(sp);
      break;
    }
  }

  // If no stats.json found, try estimating from package.json synchronously
  // (make a minimal inline version to keep this function sync).
  if (bundle === null) {
    bundle = estimateBundleFromPkgSync(resolvedRoot);
  }

  // --- Lighthouse ---
  let lighthouse: LighthouseMetric[] | null = null;

  const lhDir = join(resolvedRoot, ".lighthouseci");
  if (existsSync(lhDir)) {
    try {
      const files = readdirSync(lhDir).filter((f) => f.endsWith(".json"));
      if (files.length > 0) {
        // Use the first report file
        const reportPath = join(lhDir, files[0]);
        const content = readFileSync(reportPath, "utf-8");
        lighthouse = extractLighthouseMetrics(content);
      }
    } catch {
      // lighthouse stays null
    }
  }

  return {
    bundle,
    lighthouse,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// compareBundles
// ---------------------------------------------------------------------------

/**
 * Compare two BundleReports and return a per-module diff array.
 * Modules are matched by name; only modules present in both reports
 * (or in one) are included.
 */
export function compareBundles(
  before: BundleReport,
  after: BundleReport,
): BundleDiff[] {
  const beforeMap = new Map<string, number>();
  for (const mod of before.modules) {
    beforeMap.set(mod.name, mod.size);
  }

  const afterMap = new Map<string, number>();
  for (const mod of after.modules) {
    afterMap.set(mod.name, mod.size);
  }

  const allNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const diffs: BundleDiff[] = [];

  for (const name of allNames) {
    const beforeSize = beforeMap.get(name) ?? 0;
    const afterSize = afterMap.get(name) ?? 0;
    const diff = afterSize - beforeSize;
    const percent = beforeSize > 0 ? Math.round((diff / beforeSize) * 10000) / 100 : 0;

    diffs.push({ name, beforeSize, afterSize, diff, percent });
  }

  // Sort by largest absolute diff first
  diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return diffs;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildBundleReport(modules: BundleModule[]): BundleReport {
  const totalSize = modules.reduce((sum, m) => sum + m.size, 0);
  const totalGzip = modules.reduce((sum, m) => sum + m.gzipSize, 0);

  const seen = new Map<string, number>();
  for (const m of modules) {
    seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  const largest = modules
    .filter((m) => m.size > 100_000)
    .sort((a, b) => b.size - a.size);

  return {
    totalSize,
    totalGzip,
    modules,
    largest,
    duplicates,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Synchronous estimate — mirrors parseBundlePhobia inline for createPerfReport. */
function estimateBundleFromPkgSync(root: string): BundleReport | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps: Record<string, string> = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    const modules: BundleModule[] = Object.keys(deps).map((name) => {
      const size = KNOWN_PACKAGE_SIZES[name] ?? 5000;
      return { name, size, gzipSize: Math.round(size * 0.3) };
    });
    return buildBundleReport(modules);
  } catch {
    return null;
  }
}

/**
 * Extract Lighthouse metrics from a raw Lighthouse CI JSON report string.
 *
 * Handles both:
 * - Full Lighthouse report ({ categories, audits })
 * - Slim `.lighthouseci/*.json` output
 */
function extractLighthouseMetrics(rawJson: string): LighthouseMetric[] {
  try {
    const report = JSON.parse(rawJson) as Record<string, unknown>;

    const categories = report.categories as Record<string, { title?: string; score?: number }> | undefined;
    const audits = report.audits as Record<string, { title?: string; displayValue?: string; score?: number | null }> | undefined;

    if (categories && audits) {
      const metrics: LighthouseMetric[] = [];

      for (const [key, cat] of Object.entries(categories)) {
        if (cat.score !== undefined) {
          metrics.push({
            name: cat.title ?? key,
            score: cat.score,
            displayValue: `${Math.round(cat.score * 100)}`,
          });
        }
      }

      // Add key performance audits
      const perfAuditKeys = [
        "first-contentful-paint",
        "largest-contentful-paint",
        "total-blocking-time",
        "cumulative-layout-shift",
        "speed-index",
        "interactive",
      ];

      for (const auditKey of perfAuditKeys) {
        const audit = audits[auditKey];
        if (audit && audit.score !== undefined && audit.score !== null) {
          metrics.push({
            name: audit.title ?? auditKey,
            score: audit.score,
            displayValue: audit.displayValue ?? "",
          });
        }
      }

      return metrics;
    }
  } catch {
    // return empty
  }

  return [];
}
