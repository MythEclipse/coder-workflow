import assert from "node:assert/strict";
import { test } from "node:test";
import { javascriptParser, typescriptParser } from "../../src/graph/parsers/javascript.js";

test("javascriptParser extracts functions, classes, and const arrow functions", async () => {
  const source = `
    export async function fetchData() {}
    class MyComponent extends React.Component {}
    const helper = () => { return true; }
    export const asyncHelper = async () => false;
  `;
  const sanitized = javascriptParser.sanitize(source);
  const symbols = await javascriptParser.extractSymbols(sanitized, "src/index.js");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("fetchData"));
  assert.ok(names.includes("MyComponent"));
  assert.ok(names.includes("helper"));
  assert.ok(names.includes("asyncHelper"));
});

test("typescriptParser extracts interfaces and abstract classes", async () => {
  const source = `
    export interface UserData {}
    abstract class BaseHandler {}
  `;
  const sanitized = typescriptParser.sanitize(source);
  const symbols = await typescriptParser.extractSymbols(sanitized, "src/types.ts");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("UserData"));
  assert.ok(names.includes("BaseHandler"));
});

test("javascriptParser parses default and destructured imports", async () => {
  const source = `
    import React from 'react';
    import { useState, useEffect as useFx } from "react";
    const express = require('express');
    const { Router } = require('express');
  `;
  const importMap = await javascriptParser.parseImports(source);
  assert.equal(importMap.get("React"), "react");
  assert.equal(importMap.get("useState"), "react");
  assert.equal(importMap.get("useFx"), "react");
  assert.equal(importMap.get("express"), "express");
  assert.equal(importMap.get("Router"), "express");
});

test("javascriptParser extracts component usage", async () => {
  const source = `
    class User extends React.Component implements BaseUser {
    }
  `;
  const sanitized = typescriptParser.sanitize(source);
  const symbols: any[] = [
    { id: "symbol:User", name: "User", type: "class", path: "", language: "typescript", line: 1 },
  ];
  const symbolByName: Map<string, any[]> = new Map([
    ["User", symbols],
    [
      "BaseUser",
      [
        {
          id: "symbol:BaseUser",
          name: "BaseUser",
          type: "class",
          path: "",
          language: "typescript",
          line: 1,
        },
      ],
    ],
  ]);
  const edges = await typescriptParser.extractRelationshipEdges(sanitized, symbols, symbolByName);
  const targetNames = edges.map((e) => e.evidence);
  assert.ok(targetNames.includes("BaseUser"));
});

test("javascriptParser resolves relative imports", async () => {
  const filePaths = new Set(["src/utils/helper.ts", "src/utils/index.ts"]);

  const resolved = await typescriptParser.resolveImportTarget("./helper", "src/utils/main.ts", filePaths);
  assert.equal(resolved, "src/utils/helper.ts");

  const resolvedDir = await typescriptParser.resolveImportTarget(".", "src/utils/main.ts", filePaths);
  assert.equal(resolvedDir, "src/utils/index.ts");
});
