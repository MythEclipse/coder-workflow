import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface FunctionComplexity {
  name: string;
  file: string;
  line: number;
  complexity: number;
  params: number;
  lines: number;
}

export interface FileComplexity {
  file: string;
  path: string;
  functions: FunctionComplexity[];
  averageComplexity: number;
  maxComplexity: number;
  totalFunctions: number;
}

export interface ComplexityReport {
  files: FileComplexity[];
  totalFiles: number;
  overallAverage: number;
  hotspots: FileComplexity[];
  generatedAt: string;
}

export interface ComplexityChange {
  file: string;
  metric: string;
  before: number;
  after: number;
  change: number;
}

export interface ComplexityTrend {
  report: ComplexityReport;
  previousReport?: ComplexityReport;
  changes: ComplexityChange[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HISTORY_FILE = ".claude/complexity-history.json";

const DEFAULT_GLOB = /\.(ts|js|tsx|jsx)$/;

const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git", ".claude"]);

// ---------------------------------------------------------------------------
// measureComplexity
// ---------------------------------------------------------------------------

function countParams(funcMatch: string): number {
  // Extract the parameter list from the matched function string
  // Patterns handled:
  //   function foo(a, b, c)
  //   foo = (a, b) =>
  //   foo(a, b) {
  const paramsMatch = funcMatch.match(/\(([^)]*)\)/);
  if (!paramsMatch) return 0;
  const raw = paramsMatch[1].trim();
  if (raw.length === 0) return 0;
  return raw.split(",").length;
}

function measureFunctionComplexity(
  body: string,
  funcName: string,
  funcLine: number,
  funcParams: number,
  filePath: string,
  lines: number,
): FunctionComplexity {
  let complexity = 1; // base

  // +1 per if / else-if
  // \bif\s*\( matches both "if (" and the "if" inside "else if (",
  // so this single regex already captures all conditional branches.
  // The separate else-if regex below is kept only for documentation /
  // debug logging purposes — it is not double-added.
  const ifMatches = body.match(/\bif\s*\(/g);
  if (ifMatches) complexity += ifMatches.length;
  // \belse\s+if\s*\( count is intentionally NOT added because \bif\s*\(
  // already matched those occurrences. Adding it would double-count.

  // +1 per for (including for-in, for-of)
  const forMatches = body.match(/\bfor\s*\(/g);
  if (forMatches) complexity += forMatches.length;

  // +1 per while
  const whileMatches = body.match(/\bwhile\s*\(/g);
  if (whileMatches) complexity += whileMatches.length;

  // +1 per case (but not default or inside nested switch – we count all case labels)
  // Count lines starting with "case " or "case\t"
  const caseMatches = body.match(/^\s*case\s+.*:/gm);
  if (caseMatches) complexity += caseMatches.length;

  // +1 per catch
  const catchMatches = body.match(/\bcatch\s*\(/g);
  if (catchMatches) complexity += catchMatches.length;

  // +1 per conditional && or || operator
  // grep for && and || outside of comments/strings (approx: simple regex)
  const andOrMatches = body.match(/&&|\|\|/g);
  if (andOrMatches) complexity += andOrMatches.length;

  // +1 per ternary ? (rough: a ? ... : ...)
  const ternaryMatches = body.match(/\?/g);
  if (ternaryMatches) complexity += ternaryMatches.length;

  return {
    name: funcName,
    file: path.basename(filePath || ""),
    line: funcLine,
    complexity,
    params: funcParams,
    lines,
  };
}

export function measureComplexity(
  code: string,
  filePath?: string,
): FunctionComplexity[] {
  const results: FunctionComplexity[] = [];

  // Regex to find function boundaries.
  // Patterns:
  //   function foo(...) {
  //   const foo = (...) => { / function(...) {
  //   foo(...) {
  //   methodName(...) {
  const funcRegex =
    /(?:function\s+\w+|\w+\s*=\s*(?:async\s*)?\(|\w+\s*\([^)]*\)\s*\{)/g;

  // const lines = code.split("\n"); // unused

  // Also find arrow functions assigned to identifiers:
  //   const foo = (...) => ...
  //   let foo = (...) => ...
  const arrowFuncRegex =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*{?/g;

  // Combine: first collect standard functions, then arrow assignments.
  // We use a simpler approach: iterate line by line and collect matches.

  let match: RegExpExecArray | null;
  const matchedLines = new Set<number>();

  // --- Standard functions ---
  while ((match = funcRegex.exec(code)) !== null) {
    const matchIndex = match.index;
    const matchedText = match[0];
    const lineNum = code.substring(0, matchIndex).split("\n").length;

    if (matchedLines.has(lineNum)) continue;
    matchedLines.add(lineNum);

    // Determine function name
    let funcName = "(anonymous)";
    const nameMatch = matchedText.match(/function\s+(\w+)/);
    if (nameMatch) {
      funcName = nameMatch[1];
    } else {
      // Try `foo = (...)`
      const assignMatch = matchedText.match(/(\w+)\s*=\s*(?:async\s*)?\(/);
      if (assignMatch) {
        funcName = assignMatch[1];
      } else {
        // Try `foo(...) {`
        const callMatch = matchedText.match(/(\w+)\s*\(/);
        if (callMatch) {
          funcName = callMatch[1];
        }
      }
    }

    const params = countParams(matchedText);

    // Extract the function body (find matching closing brace)
    // Start scanning from the opening brace
    const bodyAfter = code.substring(matchIndex);
    const braceStart = bodyAfter.indexOf("{");
    if (braceStart === -1) continue;

    let depth = 0;
    let bodyEnd = -1;
    for (let i = braceStart; i < bodyAfter.length; i++) {
      if (bodyAfter[i] === "{") depth++;
      if (bodyAfter[i] === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd === -1) continue;

    const body = bodyAfter.substring(0, bodyEnd + 1);
    const bodyLines = body.split("\n").length;

    results.push(
      measureFunctionComplexity(
        body,
        funcName,
        lineNum,
        params,
        filePath || "",
        bodyLines,
      ),
    );
  }

  // --- Arrow-function assignments (const/let/var name = (...) => ...) ---
  while ((match = arrowFuncRegex.exec(code)) !== null) {
    const matchIndex = match.index;
    const lineNum = code.substring(0, matchIndex).split("\n").length;

    if (matchedLines.has(lineNum)) continue;
    matchedLines.add(lineNum);

    const funcName = match[1];
    const arrowArgs = match[0].match(/\([^)]*\)/);
    const params = arrowArgs ? countParams(arrowArgs[0]) : 0;

    // Extract the arrow body: from the matched text end to next statement/semicolon/brace
    const afterArrow = code.substring(matchIndex + match[0].length).trimStart();
    let body: string;
    let bodyLines: number;

    if (afterArrow.startsWith("{")) {
      // Block body: find matching }
      let depth = 0;
      let end = -1;
      for (let i = 0; i < afterArrow.length; i++) {
        if (afterArrow[i] === "{") depth++;
        if (afterArrow[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      body = end !== -1 ? afterArrow.substring(0, end + 1) : afterArrow;
    } else {
      // Expression body: take until end of line or semicolon
      const semiIdx = afterArrow.search(/[;,]/);
      body = semiIdx !== -1 ? afterArrow.substring(0, semiIdx) : afterArrow;
    }
    bodyLines = body.split("\n").length;

    results.push(
      measureFunctionComplexity(
        body,
        funcName,
        lineNum,
        params,
        filePath || "",
        bodyLines,
      ),
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// analyzeFile
// ---------------------------------------------------------------------------

export function analyzeFile(filePath: string): FileComplexity {
  const absolutePath = path.resolve(filePath);
  const code = fs.readFileSync(absolutePath, "utf-8");
  const functions = measureComplexity(code, absolutePath);

  const totalComplexity = functions.reduce((sum, f) => sum + f.complexity, 0);
  const count = functions.length;
  const avg = count > 0 ? totalComplexity / count : 0;
  const maxC = count > 0 ? Math.max(...functions.map((f) => f.complexity)) : 0;

  return {
    file: path.basename(absolutePath),
    path: absolutePath,
    functions,
    averageComplexity: avg,
    maxComplexity: maxC,
    totalFunctions: count,
  };
}

// ---------------------------------------------------------------------------
// analyzeDirectory
// ---------------------------------------------------------------------------

export function analyzeDirectory(
  root: string,
  glob?: string,
): ComplexityReport {
  const rootPath = path.resolve(root);
  const pattern = glob ? new RegExp(glob) : DEFAULT_GLOB;
  const files: FileComplexity[] = [];
  const hotspots: FileComplexity[] = [];
  let totalComplexitySum = 0;
  let totalFuncCount = 0;

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        try {
          const fc = analyzeFile(full);
          files.push(fc);
          totalComplexitySum += fc.averageComplexity * fc.totalFunctions;
          totalFuncCount += fc.totalFunctions;
          if (fc.averageComplexity > 10) {
            hotspots.push(fc);
          }
        } catch {
          // skip files that can't be read
        }
      }
    }
  }

  walk(rootPath);

  const overallAvg = totalFuncCount > 0
    ? totalComplexitySum / totalFuncCount
    : 0;

  // Sort hotspots descending by average complexity
  hotspots.sort((a, b) => b.averageComplexity - a.averageComplexity);

  return {
    files,
    totalFiles: files.length,
    overallAverage: overallAvg,
    hotspots,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// trackComplexityTrend
// ---------------------------------------------------------------------------

export function trackComplexityTrend(root: string): ComplexityTrend {
  const rootPath = path.resolve(root);
  const report = analyzeDirectory(rootPath);
  const historyPath = path.join(rootPath, HISTORY_FILE);

  let previousReport: ComplexityReport | undefined;
  try {
    const raw = fs.readFileSync(historyPath, "utf-8");
    previousReport = JSON.parse(raw) as ComplexityReport;
  } catch {
    // no previous report
  }

  const changes: ComplexityChange[] = [];

  if (previousReport) {
    const prevMap = new Map<string, FileComplexity>();
    for (const pf of previousReport.files) {
      prevMap.set(pf.path, pf);
    }

    for (const cf of report.files) {
      const pf = prevMap.get(cf.path);
      if (pf) {
        const avgDelta = cf.averageComplexity - pf.averageComplexity;
        if (avgDelta !== 0) {
          changes.push({
            file: cf.path,
            metric: "averageComplexity",
            before: pf.averageComplexity,
            after: cf.averageComplexity,
            change: avgDelta,
          });
        }
        const maxDelta = cf.maxComplexity - pf.maxComplexity;
        if (maxDelta !== 0) {
          changes.push({
            file: cf.path,
            metric: "maxComplexity",
            before: pf.maxComplexity,
            after: cf.maxComplexity,
            change: maxDelta,
          });
        }
        if (cf.totalFunctions !== pf.totalFunctions) {
          changes.push({
            file: cf.path,
            metric: "totalFunctions",
            before: pf.totalFunctions,
            after: cf.totalFunctions,
            change: cf.totalFunctions - pf.totalFunctions,
          });
        }
      } else {
        changes.push({
          file: cf.path,
          metric: "totalFunctions",
          before: 0,
          after: cf.totalFunctions,
          change: cf.totalFunctions,
        });
      }
    }
  }

  // Write new report to history
  const historyDir = path.dirname(historyPath);
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  fs.writeFileSync(historyPath, JSON.stringify(report, null, 2), "utf-8");

  return { report, previousReport, changes };
}

// ---------------------------------------------------------------------------
// formatComplexityReport
// ---------------------------------------------------------------------------

export function formatComplexityReport(report: ComplexityReport): string {
  const lines: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n);

  lines.push("");
  lines.push("Complexity Report");
  lines.push("=".repeat(60));
  lines.push(`  Generated:   ${report.generatedAt}`);
  lines.push(`  Files:       ${report.totalFiles}`);
  lines.push(`  Functions:   ${report.files.reduce((s, f) => s + f.totalFunctions, 0)}`);
  lines.push(`  Avg complexity: ${report.overallAverage.toFixed(2)}`);
  lines.push("");

  // ---- Per-file table ----
  const header = `${pad("File", 40)} ${pad("Funcs", 6)} ${pad("Avg", 8)} ${pad("Max", 6)} ${"Indicator"}`;
  const sep = "-".repeat(header.length);
  lines.push(header);
  lines.push(sep);

  for (const f of report.files) {
    const indicator =
      f.averageComplexity > 20
        ? "\u{1F534}" // red circle
        : f.averageComplexity > 10
          ? "\u{1F7E1}" // yellow circle
          : "\u{1F7E2}"; // green circle

    lines.push(
      `${pad(f.file, 40)} ${pad(String(f.totalFunctions), 6)} ${pad(f.averageComplexity.toFixed(2), 8)} ${pad(String(f.maxComplexity), 6)} ${indicator}`,
    );
  }
  lines.push("");

  // ---- Hotspots ----
  if (report.hotspots.length > 0) {
    lines.push("Hotspots (avg > 10)");
    lines.push("=".repeat(60));
    for (const h of report.hotspots) {
      lines.push(`  ${h.file}`);
      for (const fn of h.functions) {
        lines.push(
          `    L${fn.line.toString().padStart(4)}  ${fn.name.padEnd(30)}  complexity: ${fn.complexity}  params: ${fn.params}  lines: ${fn.lines}`,
        );
      }
      lines.push("");
    }
  }

  // ---- Indicator key ----
  lines.push("Key:");
  lines.push("  \u{1F7E2} <= 10  \u{1F7E1} 11–20  \u{1F534} > 20");
  lines.push("");

  return lines.join("\n");
}
