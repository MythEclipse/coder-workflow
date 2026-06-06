import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { extname, join } from "node:path";
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
  external: ["node:*", "typescript", "@libsql/client", "blessed", "term.js", "pty.js"],
};

await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
});

await build({
  ...shared,
  entryPoints: ["src/mcp-server.ts"],
  outfile: "dist/mcp-server.js",
});

await build({
  ...shared,
  entryPoints: [
    "test/cli-quality-gate.test.ts",
    "test/git-diff.test.ts",
    "test/graph.test.ts",
    "test/mcp-quality-gate.test.ts",
    "test/search.test.ts",
    "test/fs-tools.test.ts",
    "test/parsers/java.test.ts",
    "test/parsers/kotlin.test.ts",
    "test/parsers/javascript.test.ts",
    "test/parsers/python.test.ts",
    "test/parsers/go.test.ts",
    "test/parsers/rust.test.ts",
    "test/sequential-thinking.test.ts",
    "test/complexity-tracker.test.ts",
    "test/todo-tracker.test.ts",
    "test/performance-audit.test.ts",
    "test/log-analyzer.test.ts",
    "test/coverage-aggregator.test.ts",
    "test/i18n-helper.test.ts",
    "test/codebase-stats.test.ts",
    "test/compress.test.ts",
    "test/learn.test.ts",
    "test/cross-agent-memory.test.ts",
    "test/cache-aligner.test.ts",
    "test/api-contract.test.ts",
    "test/config-validator.test.ts",
    "test/license-checker.test.ts",
    "test/db-schema.test.ts",
    "test/doctor.test.ts",
    "test/git-hooks.test.ts",
    "test/vuln-sbom.test.ts",
    "test/secrets.test.ts",
    "test/release.test.ts",
    "test/adr.test.ts",
    "test/codebase-qa.test.ts",
    "test/tier3.test.ts",
  ],
  outdir: "dist/test",
  packages: "external",
});

await chmod("dist/cli.js", 0o755);
await chmod("dist/mcp-server.js", 0o755);

// ── Build manifest with SHA-256 checksums ──
function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile() && extname(entry.name) === ".js") {
      results.push(full);
    }
  }
  return results;
}

const distFiles = collectFiles("dist");
const manifest = {};
for (const file of distFiles) {
  const content = readFileSync(file);
  manifest[file] = createHash("sha256").update(content).digest("hex");
}

writeFileSync(
  "dist/MANIFEST.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2),
);
console.log(`  dist/MANIFEST.json — ${Object.keys(manifest).length} files checksummed`);
