import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBundleReport,
  compareBundles,
} from "../src/performance-audit.js";
import type { BundleReport, BundleDiff } from "../src/performance-audit.js";

// ---------------------------------------------------------------------------
// formatBundleReport
// ---------------------------------------------------------------------------

test("formatBundleReport - produces formatted output with totals", () => {
  const report: BundleReport = {
    totalSize: 250000,
    totalGzip: 75000,
    modules: [
      { name: "react", size: 6832, gzipSize: 2049 },
      { name: "react-dom", size: 130912, gzipSize: 39274 },
    ],
    largest: [
      { name: "react-dom", size: 130912, gzipSize: 39274 },
    ],
    duplicates: [],
  };

  const output = formatBundleReport(report);
  assert.ok(output.includes("Bundle Report"));
  assert.ok(output.includes("244.1 KB") || output.includes("244")); // totalSize ≈ 244 KB
  assert.ok(output.includes("73.2 KB") || output.includes("73")); // totalGzip ≈ 73 KB
  assert.ok(output.includes("Modules:           2"));
  assert.ok(output.includes("Duplicates:        none"));
});

test("formatBundleReport - shows largest modules", () => {
  const report: BundleReport = {
    totalSize: 600000,
    totalGzip: 180000,
    modules: [
      { name: "three", size: 606000, gzipSize: 181800 },
      { name: "react-dom", size: 130912, gzipSize: 39274 },
    ],
    largest: [
      { name: "three", size: 606000, gzipSize: 181800 },
      { name: "react-dom", size: 130912, gzipSize: 39274 },
    ],
    duplicates: [],
  };

  const output = formatBundleReport(report);
  assert.ok(output.includes("Largest Modules"));
  assert.ok(output.includes("three"));
  assert.ok(output.includes("react-dom"));
});

test("formatBundleReport - highlights duplicates warning", () => {
  const report: BundleReport = {
    totalSize: 10000,
    totalGzip: 3000,
    modules: [
      { name: "lodash", size: 5000, gzipSize: 1500 },
    ],
    largest: [],
    duplicates: ["lodash"],
  };

  const output = formatBundleReport(report);
  assert.ok(output.includes("WARNING"));
  assert.ok(output.includes("lodash"));
});

test("formatBundleReport - handles empty modules", () => {
  const report: BundleReport = {
    totalSize: 0,
    totalGzip: 0,
    modules: [],
    largest: [],
    duplicates: [],
  };

  const output = formatBundleReport(report);
  assert.ok(output.includes("Bundle Report"));
  assert.ok(output.includes("Modules:           0"));
});

test("formatBundleReport - handles zero values", () => {
  const report: BundleReport = {
    totalSize: 0,
    totalGzip: 0,
    modules: [],
    largest: [],
    duplicates: [],
  };

  const output = formatBundleReport(report);
  assert.ok(output.includes("0 B"));
});

// ---------------------------------------------------------------------------
// compareBundles
// ---------------------------------------------------------------------------

test("compareBundles - detects added modules", () => {
  const before: BundleReport = {
    totalSize: 10000,
    totalGzip: 3000,
    modules: [{ name: "a", size: 10000, gzipSize: 3000 }],
    largest: [],
    duplicates: [],
  };

  const after: BundleReport = {
    totalSize: 20000,
    totalGzip: 6000,
    modules: [
      { name: "a", size: 10000, gzipSize: 3000 },
      { name: "b", size: 10000, gzipSize: 3000 },
    ],
    largest: [],
    duplicates: [],
  };

  const diffs = compareBundles(before, after);
  const diffB = diffs.find((d) => d.name === "b");
  assert.ok(diffB);
  assert.equal(diffB.beforeSize, 0);
  assert.equal(diffB.afterSize, 10000);
  assert.equal(diffB.diff, 10000);
});

test("compareBundles - detects removed modules", () => {
  const before: BundleReport = {
    totalSize: 20000,
    totalGzip: 6000,
    modules: [
      { name: "a", size: 10000, gzipSize: 3000 },
      { name: "b", size: 10000, gzipSize: 3000 },
    ],
    largest: [],
    duplicates: [],
  };

  const after: BundleReport = {
    totalSize: 10000,
    totalGzip: 3000,
    modules: [{ name: "a", size: 10000, gzipSize: 3000 }],
    largest: [],
    duplicates: [],
  };

  const diffs = compareBundles(before, after);
  const diffB = diffs.find((d) => d.name === "b");
  assert.ok(diffB);
  assert.equal(diffB.beforeSize, 10000);
  assert.equal(diffB.afterSize, 0);
  assert.equal(diffB.diff, -10000);
});

test("compareBundles - calculates percent change correctly", () => {
  const before: BundleReport = {
    totalSize: 2000,
    totalGzip: 600,
    modules: [{ name: "x", size: 2000, gzipSize: 600 }],
    largest: [],
    duplicates: [],
  };

  const after: BundleReport = {
    totalSize: 3000,
    totalGzip: 900,
    modules: [{ name: "x", size: 3000, gzipSize: 900 }],
    largest: [],
    duplicates: [],
  };

  const diffs = compareBundles(before, after);
  const diffX = diffs.find((d) => d.name === "x");
  assert.ok(diffX);
  assert.equal(diffX.diff, 1000);
  assert.equal(diffX.percent, 50); // (1000/2000)*100 = 50%
});

test("compareBundles - returns empty array for identical reports", () => {
  const report: BundleReport = {
    totalSize: 5000,
    totalGzip: 1500,
    modules: [{ name: "a", size: 5000, gzipSize: 1500 }],
    largest: [],
    duplicates: [],
  };

  const diffs = compareBundles(report, report);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].diff, 0);
  assert.equal(diffs[0].percent, 0);
});

test("compareBundles - handles both empty", () => {
  const empty: BundleReport = {
    totalSize: 0,
    totalGzip: 0,
    modules: [],
    largest: [],
    duplicates: [],
  };

  const diffs = compareBundles(empty, empty);
  assert.deepEqual(diffs, []);
});

test("compareBundles - sorts by absolute diff descending", () => {
  const before: BundleReport = {
    totalSize: 35000,
    totalGzip: 10500,
    modules: [
      { name: "small", size: 5000, gzipSize: 1500 },
      { name: "large", size: 30000, gzipSize: 9000 },
    ],
    largest: [],
    duplicates: [],
  };

  const after: BundleReport = {
    totalSize: 20000,
    totalGzip: 6000,
    modules: [
      { name: "small", size: 10000, gzipSize: 3000 },
      { name: "large", size: 10000, gzipSize: 3000 },
    ],
    largest: [],
    duplicates: [],
  };

  const diffs = compareBundles(before, after);
  // Should be sorted by |diff| descending: large (-20000) first, then small (+5000)
  assert.equal(diffs[0].name, "large");
  assert.equal(diffs[1].name, "small");
});
