import { existsSync, readFileSync } from "node:fs";

const path = ".codegraph/coverage-summary.json";
if (existsSync(path)) {
  try {
    const c = JSON.parse(readFileSync(path, "utf8"));
    const r = c.total?.lines?.pct ?? 0;
    console.log(`Coverage: ${r}% (threshold: 30%)`);
    if (r < 30) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Failed to parse coverage summary:", err);
    process.exit(1);
  }
} else {
  console.log("No coverage report found, skipping threshold check");
}
