import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonParser } from "../../src/graph/parsers/python.js";

test("pythonParser extracts classes and functions including async and decorators", () => {
  const source = `
    class MyService:
        def process(self):
            pass

    @retry(times=3)
    def fetch_data():
        pass

    async def async_worker():
        pass
  `;
  const sanitized = pythonParser.sanitize(source);
  const symbols = pythonParser.extractSymbols(sanitized, "app/worker.py");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("MyService"));
  assert.ok(names.includes("process"));
  assert.ok(names.includes("fetch_data"));
  assert.ok(names.includes("async_worker"));
});

test("pythonParser handles nested functions and multi-line strings", () => {
  const source = `
    def outer_func():
        """
        This is a docstring
        def fake_func():
            pass
        """
        def inner_func():
            pass
        return inner_func
  `;
  const sanitized = pythonParser.sanitize(source);
  const symbols = pythonParser.extractSymbols(sanitized, "app/main.py");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("outer_func"));
  assert.ok(names.includes("inner_func"));
  // Ensure we don't extract functions inside docstrings
  assert.ok(!names.includes("fake_func"));
});

test("pythonParser parses standard and wildcard imports", () => {
  const source = `
    import os
    import sys, json
    from datetime import datetime, timedelta
    from app.models import *
    from app.services import UserService as UService
  `;
  const importMap = pythonParser.parseImports(source);
  assert.equal(importMap.get("os"), "os");
  assert.equal(importMap.get("sys"), "sys");
  assert.equal(importMap.get("json"), "json");
  assert.equal(importMap.get("datetime"), "datetime.datetime");
  assert.equal(importMap.get("timedelta"), "datetime.timedelta");
  assert.equal(importMap.get("UService"), "app.services.UserService");
});

test("pythonParser extracts routing decorators", () => {
  const source = `
    @app.route('/login', methods=['POST'])
    def login(): pass

    @router.get("/users/{id}")
    def get_user(id): pass
  `;
  const routes = pythonParser.extractRoutes(source, "src/app.py");
  const names = routes.map((r) => r.name);
  assert.ok(names.includes("/login"));
  assert.ok(names.includes("/users/{id}"));
});

test("pythonParser extracts class inheritance relationship edges", () => {
  const source = `
    class BaseService:
        pass

    class UserService(BaseService):
        pass
  `;
  const sanitized = pythonParser.sanitize(source);
  const symbols = pythonParser.extractSymbols(sanitized, "src/services.py");
  const symbolByName = new Map(symbols.map((symbol) => [symbol.name, [symbol]]));

  const edges = pythonParser.extractRelationshipEdges(sanitized, symbols, symbolByName);

  assert.deepEqual(
    edges.map((edge) => ({ type: edge.type, source: edge.source, target: edge.target })),
    [
      {
        type: "extends",
        source: "symbol:src/services.py:UserService",
        target: "symbol:src/services.py:BaseService",
      },
    ],
  );
});
