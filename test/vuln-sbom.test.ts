import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { VulnScanReport } from "../src/vuln-sbom.js";
import {
  formatVulnReport,
  generateSBOM,
  scanDependencies,
  scanVulnerabilities,
} from "../src/vuln-sbom.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-vuln-sbom-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("scanDependencies extracts npm packages from package.json", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: { lodash: "^4.17.20", express: "^4.18.0" },
      devDependencies: { vitest: "^1.0.0" },
    }),
  });

  const deps = scanDependencies(root);

  assert.equal(deps.length, 3);
  const lodash = deps.find((d) => d.name === "lodash");
  assert.ok(lodash);
  assert.equal(lodash.version, "4.17.20");
  assert.equal(lodash.type, "npm");
  assert.equal(lodash.path, "package.json");

  const vitest = deps.find((d) => d.name === "vitest");
  assert.ok(vitest);
  assert.equal(vitest.version, "1.0.0");

  const express = deps.find((d) => d.name === "express");
  assert.ok(express);
  assert.equal(express.version, "4.18.0");
});

test("scanDependencies extracts pip packages from requirements.txt", () => {
  const root = fixture({
    "requirements.txt": [
      "flask==2.3.0",
      "requests>=2.31.0",
      "# this is a comment",
      "-r base.txt",
      "numpy",
    ].join("\n"),
  });

  const deps = scanDependencies(root);

  assert.equal(deps.length, 3);
  assert.ok(deps.find((d) => d.name === "flask"));
  assert.equal(deps.find((d) => d.name === "flask")?.version, "2.3.0");
  assert.ok(deps.find((d) => d.name === "requests"));
  assert.ok(deps.find((d) => d.name === "numpy"));
  assert.equal(deps.find((d) => d.name === "numpy")?.version, "*");
  assert.equal(deps.filter((d) => d.type === "pip").length, 3);
});

test("scanDependencies extracts cargo packages from Cargo.toml", () => {
  const root = fixture({
    "Cargo.toml": [
      "[package]",
      'name = "test-crate"',
      'version = "0.1.0"',
      "",
      "[dependencies]",
      'serde = "1.0"',
      'tokio = { version = "1.35", features = ["full"] }',
      "",
      "[dev-dependencies]",
      'criteria = "0.5"',
    ].join("\n"),
  });

  const deps = scanDependencies(root);

  assert.ok(deps.length >= 1);
  assert.ok(deps.find((d) => d.name === "serde"));
  assert.equal(deps.find((d) => d.name === "serde")?.version, "1.0");
  assert.equal(deps.find((d) => d.name === "serde")?.type, "cargo");
  // tokio with object syntax should NOT match the simple pattern
  assert.equal(
    deps.filter((d) => d.name === "tokio").length,
    0,
    "complex cargo dep syntax should not match simple pattern",
  );
});

test("scanDependencies returns empty array for empty project", () => {
  const root = fixture({});

  const deps = scanDependencies(root);

  assert.deepEqual(deps, []);
});

test("scanDependencies merges multiple manifest types", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "multi",
      dependencies: { zod: "^3.0.0" },
    }),
    "requirements.txt": "click==8.1.0\n",
  });

  const deps = scanDependencies(root);

  assert.equal(deps.length, 2);
  assert.ok(deps.find((d) => d.type === "npm"));
  assert.ok(deps.find((d) => d.type === "pip"));
});

test("scanDependencies handles missing package.json gracefully", () => {
  const root = fixture({
    "some-file.txt": "hello",
  });

  const deps = scanDependencies(root);

  assert.deepEqual(deps, []);
});

test("scanVulnerabilities detects known CVEs for vulnerable versions", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "vuln-test",
      dependencies: {
        lodash: "^4.17.20",
        "cross-spawn": "^7.0.4",
      },
    }),
  });

  const report = scanVulnerabilities(root);

  assert.ok(report.totalVulns >= 2);
  assert.ok(report.vulnerabilities.some((v) => v.packageName === "lodash"));
  assert.ok(report.vulnerabilities.some((v) => v.packageName === "cross-spawn"));
  assert.ok(report.scannedFiles.includes("package.json"));
  assert.equal(report.totalDeps, 2);
});

test("scanVulnerabilities returns empty for safe versions", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "safe-test",
      dependencies: {
        lodash: "^4.17.22",
        express: "^4.20.1",
      },
    }),
  });

  const report = scanVulnerabilities(root);

  assert.equal(report.totalVulns, 0);
  assert.equal(report.bySeverity.CRITICAL ?? 0, 0);
  assert.equal(report.bySeverity.HIGH ?? 0, 0);
  assert.equal(report.totalDeps, 2);
});

test("scanVulnerabilities matches version at boundary (equal to max = not vulnerable)", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "boundary-test",
      dependencies: {
        lodash: "4.17.21",
      },
    }),
  });

  const report = scanVulnerabilities(root);

  assert.equal(report.totalVulns, 0);
});

test("scanVulnerabilities counts by severity correctly", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "severity-test",
      dependencies: {
        lodash: "^4.17.20",
        express: "^4.19.0",
        axios: "^1.7.3",
        semver: "^7.6.1",
      },
    }),
  });

  const report = scanVulnerabilities(root);

  assert.ok(report.bySeverity.CRITICAL >= 1); // lodash
  assert.ok(report.bySeverity.HIGH >= 2); // express, axios
  assert.ok(report.bySeverity.MEDIUM >= 1); // semver
  assert.equal(
    report.totalVulns,
    (report.bySeverity.CRITICAL ?? 0) +
      (report.bySeverity.HIGH ?? 0) +
      (report.bySeverity.MEDIUM ?? 0) +
      (report.bySeverity.LOW ?? 0),
  );
});

test("scanVulnerabilities scans all manifest types and tracks scannedFiles", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "multi-vuln",
      dependencies: { lodash: "^4.17.20" },
    }),
    "requirements.txt": "flask==2.3.0\n",
    "Cargo.toml": ["[dependencies]", 'serde = "1.0"'].join("\n"),
  });

  const report = scanVulnerabilities(root);

  assert.ok(report.scannedFiles.includes("package.json"));
  assert.ok(report.scannedFiles.includes("requirements.txt"));
  assert.ok(report.scannedFiles.includes("Cargo.toml"));
  assert.ok(report.totalDeps >= 2);
});

test("generateSBOM produces SPDX format", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "sbom-test",
      dependencies: { lodash: "^4.17.22" },
    }),
  });

  const sbom = generateSBOM(root, "spdx");

  assert.equal(sbom.format, "spdx");
  assert.equal(sbom.packages, 1);
  assert.ok(sbom.content.includes("SPDXVersion: SPDX-2.3"));
  assert.ok(sbom.content.includes("PackageName: lodash"));
  assert.ok(sbom.content.includes("PackageVersion: 4.17.22"));
  assert.ok(sbom.content.includes("DocumentName: sbom-test"));
  assert.ok(sbom.content.includes("Creator: Tool: coder-workflow-0.3.0"));
});

test("generateSBOM produces CycloneDX format", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "cdx-test",
      dependencies: { express: "^4.20.1" },
    }),
  });

  const sbom = generateSBOM(root, "cyclonedx");

  assert.equal(sbom.format, "cyclonedx");
  assert.equal(sbom.packages, 1);
  const parsed = JSON.parse(sbom.content);
  assert.equal(parsed.bomFormat, "CycloneDX");
  assert.equal(parsed.specVersion, "1.5");
  assert.equal(parsed.metadata.component.name, "cdx-test");
  assert.equal(parsed.components[0].name, "express");
  assert.equal(parsed.components[0].version, "4.20.1");
  assert.ok(parsed.components[0].purl.startsWith("pkg:npm/express@"));
});

test("generateSBOM defaults to SPDX when format omitted", () => {
  const root = fixture({
    "package.json": JSON.stringify({
      name: "default-test",
      dependencies: { zod: "^3.22.0" },
    }),
  });

  const sbom = generateSBOM(root);

  assert.equal(sbom.format, "spdx");
  assert.ok(sbom.content.includes("PackageName: zod"));
});

test("generateSBOM with no dependencies returns zero packages", () => {
  const root = fixture({
    "package.json": JSON.stringify({ name: "empty" }),
  });

  const sbom = generateSBOM(root);

  assert.equal(sbom.packages, 0);
  assert.ok(sbom.content.includes("Packages"));
});

test("generateSBOM uses 'unknown-project' when no package.json name", () => {
  const root = fixture({
    "package.json": JSON.stringify({ version: "1.0.0" }),
  });

  const sbom = generateSBOM(root);

  assert.ok(sbom.content.includes("unknown-project"));
});

test("formatVulnReport returns clean message when no vulns found", () => {
  const report: VulnScanReport = {
    dependencies: [],
    vulnerabilities: [],
    totalDeps: 5,
    totalVulns: 0,
    bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    scannedFiles: ["package.json"],
  };

  const output = formatVulnReport(report);

  assert.match(output, /No known vulnerabilities found/);
  assert.match(output, /5 dependencies scanned/);
});

test("formatVulnReport renders vuln report with sorted severity", () => {
  const report: VulnScanReport = {
    dependencies: [],
    vulnerabilities: [
      {
        id: "CVE-2024-1111",
        packageName: "test-pkg",
        severity: "HIGH",
        title: "Test Vuln",
        description: "A test vulnerability",
        fixedIn: "2.0.0",
        cvss: 7.5,
      },
      {
        id: "CVE-2024-2222",
        packageName: "critical-pkg",
        severity: "CRITICAL",
        title: "Critical Vuln",
        description: "Critical issue",
        fixedIn: "3.0.0",
        cvss: 9.8,
      },
    ],
    totalDeps: 10,
    totalVulns: 2,
    bySeverity: { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0 },
    scannedFiles: ["package.json"],
  };

  const output = formatVulnReport(report);

  // Critical should come before HIGH (sorted by severity rank descending)
  const criticalIdx = output.indexOf("CVE-2024-2222");
  const highIdx = output.indexOf("CVE-2024-1111");
  assert.ok(criticalIdx < highIdx, "critical severity should appear before high");

  assert.match(output, /VULNERABILITY SCAN REPORT/);
  assert.match(output, /Dependencies scanned: 10/);
  assert.match(output, /Vulnerabilities found: 2/);
  assert.match(output, /Critical:\s+1/);
  assert.match(output, /High:\s+1/);
  assert.match(output, /Fix: upgrade to 2\.0\.0/);
  assert.match(output, /Fix: upgrade to 3\.0\.0/);
  assert.match(output, /CVSS: 7\.5/);
  assert.match(output, /CVSS: 9\.8/);
});

test("formatVulnReport includes vulnerability title and severity icons", () => {
  const report: VulnScanReport = {
    dependencies: [],
    vulnerabilities: [
      {
        id: "CVE-2024-3333",
        packageName: "low-pkg",
        severity: "LOW",
        title: "Minor Issue",
        description: "Low severity",
        fixedIn: "1.0.1",
      },
    ],
    totalDeps: 3,
    totalVulns: 1,
    bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 1 },
    scannedFiles: ["package.json"],
  };

  const output = formatVulnReport(report);

  assert.match(output, /CVE-2024-3333/);
  assert.match(output, /low-pkg/);
  assert.match(output, /Minor Issue/);
});

test("formatVulnReport renders MEDIUM severity vulns", () => {
  const report: VulnScanReport = {
    dependencies: [],
    vulnerabilities: [
      {
        id: "CVE-2024-4444",
        packageName: "medium-pkg",
        severity: "MEDIUM",
        title: "Medium Issue",
        description: "Medium severity",
        fixedIn: "2.0.0",
        cvss: 5.3,
      },
    ],
    totalDeps: 3,
    totalVulns: 1,
    bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    scannedFiles: ["package.json"],
  };

  const output = formatVulnReport(report);

  assert.match(output, /CVE-2024-4444/);
  assert.match(output, /medium-pkg/);
  assert.match(output, /CVSS: 5\.3/);
});
