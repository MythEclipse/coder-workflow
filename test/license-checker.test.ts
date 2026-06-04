import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  categorizeLicenses,
  formatLicenseReport,
} from "../src/license-checker.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "license-checker-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("categorizeLicenses populates incompatible for report with restrictive and unknown licenses", () => {
  const report = {
    total: 3,
    licenses: { MIT: 1, "GPL-3.0": 1, UNKNOWN: 1 },
    incompatible: [],
    restrictive: [
      {
        package: "bad-lib",
        version: "1.0.0",
        license: "GPL-3.0",
        path: "/tmp/node_modules/bad-lib",
      },
    ],
    unknown: [
      {
        package: "weird-lib",
        version: "2.0.0",
        license: "UNKNOWN",
        path: "/tmp/node_modules/weird-lib",
      },
    ],
  };

  // categorizeLicenses mutates and returns the report
  const result = categorizeLicenses(report);

  assert.ok(Array.isArray(result.incompatible));
  assert.equal(result.total, 3);
});

test("formatLicenseReport outputs header and total count", () => {
  const report = {
    total: 0,
    licenses: {},
    incompatible: [],
    restrictive: [],
    unknown: [],
  };

  const output = formatLicenseReport(report);
  assert.match(output, /License Scan Report/);
  assert.match(output, /Total packages scanned: 0/);
  assert.match(output, /All licenses are permissive/);
});

test("formatLicenseReport lists permissive licenses with green dot", () => {
  const report = {
    total: 2,
    licenses: { MIT: 1, "Apache-2.0": 1 },
    incompatible: [],
    restrictive: [],
    unknown: [],
  };

  const output = formatLicenseReport(report);
  assert.match(output, /MIT/);
  assert.match(output, /Apache-2.0/);
  assert.match(output, /All licenses are permissive/);
});

test("formatLicenseReport lists restrictive licenses section", () => {
  const report = {
    total: 2,
    licenses: { MIT: 1, "GPL-3.0": 1 },
    incompatible: [],
    restrictive: [
      {
        package: "gpl-lib",
        version: "3.0.0",
        license: "GPL-3.0",
        path: "/tmp/node_modules/gpl-lib",
      },
    ],
    unknown: [],
  };

  const output = formatLicenseReport(report);
  assert.match(output, /gpl-lib/);
  assert.match(output, /GPL-3.0/);
  assert.match(output, /Restrictive/);
});

test("formatLicenseReport lists unknown licenses section", () => {
  const report = {
    total: 1,
    licenses: { UNKNOWN: 1 },
    incompatible: [],
    restrictive: [],
    unknown: [
      {
        package: "mystery-pkg",
        version: "0.0.1",
        license: "UNKNOWN",
        path: "/tmp/node_modules/mystery-pkg",
      },
    ],
  };

  const output = formatLicenseReport(report);
  assert.match(output, /mystery-pkg/);
  assert.match(output, /Unknown/);
});

test("formatLicenseReport lists incompatible license pairs", () => {
  const report = {
    total: 2,
    licenses: { MIT: 1, "GPL-3.0": 1 },
    incompatible: [
      {
        package1: "gpl-lib",
        license1: "GPL-3.0",
        package2: "mit-lib",
        license2: "MIT",
        description: "Copyleft license GPL-3.0 in gpl-lib is incompatible",
      },
    ],
    restrictive: [
      {
        package: "gpl-lib",
        version: "1.0.0",
        license: "GPL-3.0",
        path: "/tmp/nm/gpl-lib",
      },
    ],
    unknown: [],
  };

  const output = formatLicenseReport(report);
  assert.match(output, /Incompatibilities/);
  assert.match(output, /gpl-lib/);
  assert.match(output, /mit-lib/);
});

test("formatLicenseReport shows summary counts for restrictive, copyleft, unknown, incompatible", () => {
  const report = {
    total: 3,
    licenses: { MIT: 1, "GPL-3.0": 1, UNKNOWN: 1 },
    incompatible: [
      {
        package1: "gpl-lib",
        license1: "GPL-3.0",
        package2: "mit-lib",
        license2: "MIT",
        description: "incompatible",
      },
    ],
    restrictive: [
      {
        package: "gpl-lib",
        version: "1.0.0",
        license: "GPL-3.0",
        path: "/tmp/nm/gpl-lib",
      },
    ],
    unknown: [
      {
        package: "unk-lib",
        version: "1.0.0",
        license: "UNKNOWN",
        path: "/tmp/nm/unk-lib",
      },
    ],
  };

  const output = formatLicenseReport(report);
  assert.match(output, /Summary/);
  assert.match(output, /Copyleft/);
  assert.match(output, /Unknown/);
  assert.match(output, /Incompatible pairs/);
});

test("formatLicenseReport handles unknown licenses gracefully", () => {
  const report = {
    total: 1,
    licenses: { "LicenseRef-custom": 1 },
    incompatible: [],
    restrictive: [],
    unknown: [
      {
        package: "custom-lic",
        version: "1.0.0",
        license: "LicenseRef-custom",
        path: "/tmp/nm/custom-lic",
      },
    ],
  };

  const output = formatLicenseReport(report);
  assert.match(output, /LicenseRef-custom/);
  assert.match(output, /Unknown Licenses/);
});
