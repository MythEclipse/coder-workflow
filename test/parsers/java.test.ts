import assert from "node:assert/strict";
import { test } from "node:test";
import { javaParser } from "../../src/graph/parsers/java.js";

test("javaParser extracts standard classes and methods", async () => {
  const source = `
    public class MyClass {
      public void doSomething() {}
      private int calculate(int x, int y) { return x + y; }
    }
  `;
  const sanitized = javaParser.sanitize(source);
  const symbols = await javaParser.extractSymbols(sanitized, "src/MyClass.java");
  assert.equal(symbols.length, 3);
  assert.equal(symbols[0].name, "MyClass");
  assert.equal(symbols[1].name, "doSomething");
  assert.equal(symbols[2].name, "calculate");
});

test("javaParser extracts inner classes and interfaces", async () => {
  const source = `
    public interface MyInterface {
      void interfaceMethod();
    }
    public class Outer {
      public static class Inner {
        void innerMethod() {}
      }
    }
  `;
  const sanitized = javaParser.sanitize(source);
  const symbols = await javaParser.extractSymbols(sanitized, "src/Outer.java");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("MyInterface"));
  assert.ok(names.includes("interfaceMethod"));
  assert.ok(names.includes("Outer"));
  assert.ok(names.includes("Inner"));
  assert.ok(names.includes("innerMethod"));
});

test("javaParser extracts wildcard and static imports", async () => {
  const source = `
    import java.util.*;
    import static org.junit.Assert.assertEquals;
    import com.example.MyService;
  `;
  const imports = await javaParser.extractImports(source);
  assert.ok(imports.includes("java.util.*"));
  assert.ok(imports.includes("org.junit.Assert.assertEquals"));
  assert.ok(imports.includes("com.example.MyService"));
});

test("javaParser extracts multiline annotations correctly", async () => {
  const source = `
    @RestController
    @RequestMapping(
      value = "/api/users",
      produces = "application/json"
    )
    public class UserController {
      @GetMapping(
        "/list"
      )
      public void listUsers() {}
    }
  `;
  const sanitized = javaParser.sanitize(source);
  const routes = await javaParser.extractRoutes(source, "src/UserController.java");
  const names = routes.map((r) => r.name);
  // Routes in Java parser are constructed by reading @RequestMapping / @GetMapping etc.
  assert.ok(names.some((r) => r.includes("/api/users") || r.includes("/list")));
});

test("javaParser extracts relationship edges for implements and extends", async () => {
  const source = `
    public class MyClass extends BaseClass implements InterfaceA, InterfaceB {
    }
  `;
  const sanitized = javaParser.sanitize(source);
  const symbols: any[] = [
    { id: "symbol:MyClass", name: "MyClass", type: "class", path: "", language: "java", line: 1 },
  ];
  const symbolByName: Map<string, any[]> = new Map([
    ["MyClass", symbols],
    [
      "BaseClass",
      [
        {
          id: "symbol:BaseClass",
          name: "BaseClass",
          type: "class",
          path: "",
          language: "java",
          line: 1,
        },
      ],
    ],
    [
      "InterfaceA",
      [
        {
          id: "symbol:InterfaceA",
          name: "InterfaceA",
          type: "class",
          path: "",
          language: "java",
          line: 1,
        },
      ],
    ],
    [
      "InterfaceB",
      [
        {
          id: "symbol:InterfaceB",
          name: "InterfaceB",
          type: "class",
          path: "",
          language: "java",
          line: 1,
        },
      ],
    ],
  ]);
  const edges = await javaParser.extractRelationshipEdges(sanitized, symbols, symbolByName);
  const targetNames = edges.map((e) => e.evidence);
  assert.ok(targetNames.includes("BaseClass"));
  assert.ok(targetNames.includes("InterfaceA"));
  assert.ok(targetNames.includes("InterfaceB"));
});
