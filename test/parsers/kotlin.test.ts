import assert from "node:assert/strict";
import { test } from "node:test";
import { kotlinParser } from "../../src/graph/parsers/kotlin.js";

test("kotlinParser extracts standard and data classes", async () => {
  const source = `
    class StandardClass {
      fun doWork() {}
    }
    data class UserProfile(val id: String, val name: String)
  `;
  const sanitized = kotlinParser.sanitize(source);
  const symbols = await kotlinParser.extractSymbols(sanitized, "src/Model.kt");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("StandardClass"));
  assert.ok(names.includes("doWork"));
  assert.ok(names.includes("UserProfile"));
});

test("kotlinParser extracts objects and companion objects", async () => {
  const source = `
    object SingletonManager {
      fun init() {}
    }
    class MyClass {
      companion object {
        fun create() {}
      }
    }
  `;
  const sanitized = kotlinParser.sanitize(source);
  const symbols = await kotlinParser.extractSymbols(sanitized, "src/SingletonManager.kt");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("SingletonManager"));
  assert.ok(names.includes("init"));
  assert.ok(names.includes("MyClass"));
  assert.ok(names.includes("create"));
});

test("kotlinParser extracts extension functions", async () => {
  const source = `
    fun String.removeSpaces(): String {
      return this.replace(" ", "")
    }
  `;
  const sanitized = kotlinParser.sanitize(source);
  const symbols = await kotlinParser.extractSymbols(sanitized, "src/Extensions.kt");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("removeSpaces"));
});

test("kotlinParser parses imports with aliases", async () => {
  const source = `
    import com.example.Foo
    import com.example.Bar as Baz
  `;
  const imports = await kotlinParser.extractImports(source);
  assert.ok(imports.includes("com.example.Foo"));
  assert.ok(imports.includes("com.example.Bar"));
});

test("kotlinParser resolves Java/Kotlin package imports correctly", async () => {
  const filePaths = new Set(["com/example/service/UserService.kt", "com/example/util/Helper.java"]);

  // kotlinParser uses resolveJavaPackageImport equivalent behavior
  const resolved = await kotlinParser.resolveImportTarget(
    "com.example.service.UserService",
    "src/Main.kt",
    filePaths,
  );
  assert.equal(resolved, "com/example/service/UserService.kt");

  const resolvedJava = await kotlinParser.resolveImportTarget(
    "com.example.util.Helper",
    "src/Main.kt",
    filePaths,
  );
  assert.equal(resolvedJava, "com/example/util/Helper.java");
});
