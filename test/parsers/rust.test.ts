import assert from "node:assert/strict";
import { test } from "node:test";
import { rustParser } from "../../src/graph/parsers/rust.js";

test("rustParser extracts structs, enums, traits, and impl blocks", () => {
  const source = `
    pub struct User { id: u32 }
    enum Role { Admin, Member }
    pub trait Drivable { fn drive(&self); }
    impl User {
        pub fn new() -> Self {}
    }
    impl Drivable for User {
        fn drive(&self) {}
    }
  `;
  const sanitized = rustParser.sanitize(source);
  const symbols = rustParser.extractSymbols(sanitized, "src/models.rs");
  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("User"));
  assert.ok(names.includes("Role"));
  assert.ok(names.includes("Drivable"));
  assert.ok(names.includes("new"));
  assert.ok(names.includes("drive"));
});

test("rustParser handles nested use declarations", () => {
  const source = `
    use std::collections::{HashMap, HashSet as Set};
    use crate::services::UserService;
  `;
  const importMap = rustParser.parseImports(source);
  console.log("IMPORT MAP KEYS:", Array.from(importMap.keys()));
  assert.equal(importMap.get("HashMap"), "std::collections::HashMap");
  assert.equal(importMap.get("Set"), "std::collections::HashSet");
  assert.equal(importMap.get("UserService"), "crate::services::UserService");
});

test("rustParser extracts relationship edges for implements", () => {
  const source = `
    impl Clone for User {}
    impl fmt::Display for User {}
  `;
  const sanitized = rustParser.sanitize(source);
  const symbols: any[] = [
    { id: "symbol:User", name: "User", type: "class", path: "", language: "rust", line: 1 },
  ];
  const symbolByName: Map<string, any[]> = new Map([
    ["User", symbols],
    [
      "Clone",
      [{ id: "symbol:Clone", name: "Clone", type: "class", path: "", language: "rust", line: 1 }],
    ],
    [
      "Display",
      [
        {
          id: "symbol:Display",
          name: "Display",
          type: "class",
          path: "",
          language: "rust",
          line: 1,
        },
      ],
    ],
  ]);
  const edges = rustParser.extractRelationshipEdges(sanitized, symbols, symbolByName);
  const targets = edges.map((e) => e.evidence);
  assert.ok(targets.includes("Clone"));
  assert.ok(targets.includes("Display"));
});

test("rustParser matches import paths accurately", () => {
  // src/utils.rs and crate::utils => should match
  const isMatch = rustParser.matchImport("crate::utils::helper", "src/utils.rs");
  assert.equal(isMatch, true);

  // mod.rs structure
  const isMatchMod = rustParser.matchImport("crate::utils::helper", "src/utils/mod.rs");
  assert.equal(isMatchMod, true);
});
