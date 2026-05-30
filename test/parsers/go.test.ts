import assert from "node:assert/strict";
import { test } from "node:test";
import { goParser } from "../../src/graph/parsers/go.js";

test("goParser extracts structs, interfaces, methods, and functions", () => {
  const source = `
    type User struct { ID string }
    type Reader interface { Read() }
    func DoWork() {}
    func (u *User) GetID() string { return u.ID }
  `;
  const sanitized = goParser.sanitize(source);
  const symbols = goParser.extractSymbols(sanitized, "main.go");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("User"));
  assert.ok(names.includes("Reader"));
  assert.ok(names.includes("DoWork"));
  assert.ok(names.includes("GetID"));
});

test("goParser handles multiline imports and grouping", () => {
  const source = `
    import (
      "fmt"
      "net/http"
      
      jsonparser "github.com/buger/jsonparser"
      . "github.com/onsi/ginkgo"
    )
  `;
  const importMap = goParser.parseImports(source);
  assert.equal(importMap.get("fmt"), "fmt");
  assert.equal(importMap.get("http"), "net/http");
  assert.equal(importMap.get("jsonparser"), "github.com/buger/jsonparser");
  assert.equal(importMap.get("."), "github.com/onsi/ginkgo");
});

test("goParser extracts routes from HandleFunc", () => {
  const source = `
    func main() {
      http.HandleFunc("/api/data", handleData)
      router.Handle("/users", userHandler)
    }
  `;
  const sanitized = goParser.sanitize(source);
  const routes = goParser.extractRoutes(source, "main.go");
  const names = routes.map((r) => r.name);
  assert.ok(names.includes("/api/data"));
  // router.Handle with strings should also be caught if possible,
  // currently the regex is (?:app|router|http)\.(?:get|post|put|patch|delete|HandleFunc|Handle)\(["']([^"']+)["']
  // check if our parser does it:
  assert.ok(names.includes("/users"));
});

test("goParser matches import paths accurately", () => {
  const isMatch = goParser.matchImport("github.com/myorg/myproject/pkg/util", "pkg/util/file.go");
  assert.equal(isMatch, true);

  const isFalse = goParser.matchImport("github.com/myorg/other", "pkg/util/file.go");
  assert.equal(isFalse, false);
});
