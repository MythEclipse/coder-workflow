import assert from "node:assert/strict";
import test from "node:test";
import type { ComplexityReport } from "../src/complexity-tracker.js";
import { formatComplexityReport, measureComplexity } from "../src/complexity-tracker.js";

// ---------------------------------------------------------------------------
// measureComplexity
// ---------------------------------------------------------------------------

test("measureComplexity - empty code returns empty array", () => {
  const result = measureComplexity("");
  assert.deepEqual(result, []);
});

test("measureComplexity - single function with base complexity of 1", () => {
  const code = `
function hello() {
  return "world";
}
`;
  const result = measureComplexity(code);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "hello");
  assert.equal(result[0].complexity, 1);
  assert.equal(result[0].params, 0);
});

test("measureComplexity - function with if/else branches detects both function and if blocks", () => {
  const code = `
function check(x: number): string {
  if (x > 0) {
    return "positive";
  }
  if (x === 0) {
    return "zero";
  }
  return "negative";
}
`;
  const result = measureComplexity(code);
  // The funcRegex \w+\(...\)\{ matches "if (x > 0) {" and "if (x === 0) {" as pseudo-functions,
  // so we get the real function + 2 if-blocks.
  assert.ok(result.length >= 1);
  const fn = result.find((r) => r.name === "check");
  assert.ok(fn, "should find named function 'check'");
  // check: base(1) + 2*if(2) = 3
  assert.equal(fn.complexity, 3);
  // Note: params = 0 here because the funcRegex only captures "function check",
  // not the full signature with params. See the arrow function test for param counting.
  assert.equal(fn.params, 0);
  // Additional entries are if-blocks treated as functions (known regex behavior)
});

test("measureComplexity - function with for loop also matches for as pseudo-function", () => {
  const code = `
function sum(arr: number[]): number {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];
  }
  return total;
}
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "sum");
  assert.ok(fn, "should find named function 'sum'");
  // base(1) + for(1) = 2
  assert.equal(fn.complexity, 2);
});

test("measureComplexity - function with while loop", () => {
  const code = `
function find(target: number): number {
  let i = 0;
  while (i < 100) {
    if (arr[i] === target) {
      return i;
    }
    i++;
  }
  return -1;
}
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "find");
  assert.ok(fn, "should find named function 'find'");
  // base(1) + while(1) + if(1) = 3
  assert.equal(fn.complexity, 3);
});

test("measureComplexity - function with case/switch", () => {
  const code = `
function getStatus(code: number): string {
  switch (code) {
    case 200:
      return "OK";
    case 404:
      return "Not Found";
    case 500:
      return "Error";
    default:
      return "Unknown";
  }
}
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "getStatus");
  assert.ok(fn, "should find named function 'getStatus'");
  // base(1) + 3*case(3) = 4
  assert.equal(fn.complexity, 4);
});

test("measureComplexity - function with catch", () => {
  const code = `
function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "safeParse");
  assert.ok(fn, "should find named function 'safeParse'");
  // base(1) + catch(1) = 2
  assert.equal(fn.complexity, 2);
});

test("measureComplexity - function with logical operators && and ||", () => {
  const code = `
function validate(input: string): boolean {
  return input && input.length > 0 || input === "fallback";
}
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "validate");
  assert.ok(fn, "should find named function 'validate'");
  // base(1) + &&(1) + ||(1) = 3
  assert.equal(fn.complexity, 3);
});

test("measureComplexity - function with ternary operator", () => {
  const code = `
function max(a: number, b: number): number {
  return a > b ? a : b;
}
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "max");
  assert.ok(fn, "should find named function 'max'");
  // base(1) + ternary via ?(1) = 2
  assert.equal(fn.complexity, 2);
});

test("measureComplexity - arrow function assigned to const", () => {
  const code = `
const greet = (name: string) => {
  return "Hello, " + name;
};
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "greet");
  assert.ok(fn, "should find arrow function 'greet'");
  assert.equal(fn.complexity, 1);
  // params detection for arrow: the regex extracts the full matched text
  // which includes the type annotation, so parameters aren't counted the same way
});

test("measureComplexity - arrow function expression body is not detected (regex limitation)", () => {
  const code = `
const double = (x: number) => x * 2;
`;
  const result = measureComplexity(code);
  // NOTE: Expression-body arrow functions without a { } block are not detected
  // because the funcRegex matches "double = (" but finds no opening brace,
  // while the arrowFuncRegex is dedup'd by matchedLines. This is a known
  // limitation of the regex-based approach.
  assert.equal(result.length, 0);
});

test("measureComplexity - multiple functions are all detected", () => {
  const code = `
function foo() { return 1; }
function bar() { if (true) { return 2; } }
function baz() { return 3; }
`;
  const result = measureComplexity(code);
  assert.ok(result.some((r) => r.name === "foo"));
  assert.ok(result.some((r) => r.name === "bar"));
  assert.ok(result.some((r) => r.name === "baz"));
});

test("measureComplexity - mixed complexity features in one function", () => {
  const code = `
function process(items: string[]): void {
  for (const item of items) {
    if (item.length > 0) {
      try {
        validate(item);
      } catch (e) {
        console.error(e);
      }
    }
  }
  while (true) { break; }
}
`;
  const result = measureComplexity(code);
  const fn = result.find((r) => r.name === "process");
  assert.ok(fn, "should find named function 'process'");
  // base(1) + for(1) + if(1) + catch(1) + while(1) = 5
  assert.equal(fn.complexity, 5);
});

test("measureComplexity - returns file path in result", () => {
  const code = `function hello() { return 1; }`;
  const result = measureComplexity(code, "/path/to/file.ts");
  assert.equal(result.length, 1);
  assert.ok(result[0].file.length > 0);
});

// ---------------------------------------------------------------------------
// formatComplexityReport
// ---------------------------------------------------------------------------

test("formatComplexityReport - produces valid output with all sections", () => {
  const report: ComplexityReport = {
    files: [
      {
        file: "test.ts",
        path: "/test.ts",
        functions: [{ name: "foo", file: "test.ts", line: 1, complexity: 3, params: 1, lines: 5 }],
        averageComplexity: 3,
        maxComplexity: 3,
        totalFunctions: 1,
      },
    ],
    totalFiles: 1,
    overallAverage: 3,
    hotspots: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatComplexityReport(report);

  assert.ok(output.includes("Complexity Report"));
  assert.ok(output.includes("Files:       1"));
  assert.ok(output.includes("Avg complexity: 3.00"));
  assert.ok(output.includes("test.ts"));
  assert.ok(output.includes("Key:"));
});

test("formatComplexityReport - shows hotspots section when present", () => {
  const report: ComplexityReport = {
    files: [
      {
        file: "hot.ts",
        path: "/hot.ts",
        functions: [
          { name: "hotFunc", file: "hot.ts", line: 1, complexity: 15, params: 2, lines: 30 },
        ],
        averageComplexity: 15,
        maxComplexity: 15,
        totalFunctions: 1,
      },
    ],
    totalFiles: 1,
    overallAverage: 15,
    hotspots: [
      {
        file: "hot.ts",
        path: "/hot.ts",
        functions: [
          { name: "hotFunc", file: "hot.ts", line: 1, complexity: 15, params: 2, lines: 30 },
        ],
        averageComplexity: 15,
        maxComplexity: 15,
        totalFunctions: 1,
      },
    ],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatComplexityReport(report);
  assert.ok(output.includes("Hotspots"));
  assert.ok(output.includes("hotFunc"));
});

test("formatComplexityReport - handles empty reports", () => {
  const report: ComplexityReport = {
    files: [],
    totalFiles: 0,
    overallAverage: 0,
    hotspots: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  const output = formatComplexityReport(report);
  assert.ok(output.includes("Complexity Report"));
  assert.ok(output.includes("Files:       0"));
  assert.ok(output.includes("Avg complexity: 0.00"));
});
