import { chmod } from "node:fs/promises";
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
  external: ["node:*", "typescript"],
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
    "test/batch.test.ts",
    "test/skill-triggers.test.ts",
    "test/fs-tools.test.ts",
    "test/parsers/java.test.ts",
    "test/parsers/kotlin.test.ts",
    "test/parsers/javascript.test.ts",
    "test/parsers/python.test.ts",
    "test/parsers/go.test.ts",
    "test/parsers/rust.test.ts",
  ],
  outdir: "dist/test",
  packages: "external",
});

await chmod("dist/cli.js", 0o755);
await chmod("dist/mcp-server.js", 0o755);
