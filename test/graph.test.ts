import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GraphQualityIssue } from "../src/analysis.js";
import {
  analyzeGraphQuality,
  analyzeImpact,
  evaluateQualityGate,
  findCycles,
  findOrphans,
} from "../src/analysis.js";
import { exportGraph } from "../src/exporters.js";
import { readScanCache, replaceGraphPathsInDb } from "../src/graph/db.js";
import { graphExists, readGraph, scanCodebase, writeGraph } from "../src/graph.js";
import type { CodeGraph, CodeGraphSettings } from "../src/types.js";

const settings: CodeGraphSettings = {
  languages: ["javascript", "typescript", "python", "go", "rust", "java"],
  ignorePaths: ["node_modules", ".git", "dist", "build", ".next", "vendor", ".codegraph/cache"],
  updateOnStop: true,
  updateOnEdit: false,
  commitGraphJson: false,
  maxDepth: 4,
  uiPort: 3737,
  exports: ["json", "mermaid", "dot", "markdown"],
};

test("respects .gitignore file and directory patterns by default", async () => {
  const root = fixture({
    ".gitignore": `ignored.js
ignored-dir/
*.generated.ts
`,
    "src/app.ts": `export function included() { return "ok"; }`,
    "ignored.js": `export function ignoredFile() { return "no"; }`,
    "ignored-dir/hidden.ts": `export function ignoredDirectory() { return "no"; }`,
    "src/model.generated.ts": `export function ignoredGlob() { return "no"; }`,
  });

  const graph = await scanCodebase(root, settings);

  assert.equal(graph.metadata.filesScanned, 1);
  assertNode(graph, "file:src/app.ts");
  assertMissingNode(graph, "file:ignored.js");
  assertMissingNode(graph, "file:ignored-dir/hidden.ts");
  assertMissingNode(graph, "file:src/model.generated.ts");
});

test("gitignore negation re-includes paths after broader ignore", async () => {
  const root = fixture({
    ".gitignore": `src/*.ts
!src/keep.ts
`,
    "src/skip.ts": `export function skip() { return "no"; }`,
    "src/keep.ts": `export function keep() { return "yes"; }`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  assert.equal(graph.metadata.filesScanned, 1);
  assertNode(graph, "file:src/keep.ts");
  assertMissingNode(graph, "file:src/skip.ts");
});

test("keeps configured ignorePaths and works without gitignore", async () => {
  const root = fixture({
    "src/app.ts": `export function included() { return "ok"; }`,
    "custom-ignore/hidden.ts": `export function ignoredByConfig() { return "no"; }`,
  });

  const graph = await scanCodebase(root, {
    ...settings,
    languages: ["typescript"],
    ignorePaths: ["custom-ignore"],
  });

  assert.equal(graph.metadata.filesScanned, 1);
  assertNode(graph, "file:src/app.ts");
  assertMissingNode(graph, "file:custom-ignore/hidden.ts");
});

test("gitignore negation does not override configured ignorePaths", async () => {
  const root = fixture({
    ".gitignore": `!custom-ignore/hidden.ts\n`,
    "src/app.ts": `export function included() { return "ok"; }`,
    "custom-ignore/hidden.ts": `export function ignoredByConfig() { return "no"; }`,
  });

  const graph = await scanCodebase(root, {
    ...settings,
    languages: ["typescript"],
    ignorePaths: ["custom-ignore"],
  });

  assert.equal(graph.metadata.filesScanned, 1);
  assertNode(graph, "file:src/app.ts");
  assertMissingNode(graph, "file:custom-ignore/hidden.ts");
});

test("supports double-star gitignore globs", async () => {
  const root = fixture({
    ".gitignore": `**/*.generated.ts\n`,
    "src/app.ts": `export function included() { return "ok"; }`,
    "src/nested/model.generated.ts": `export function ignoredGlob() { return "no"; }`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  assert.equal(graph.metadata.filesScanned, 1);
  assertNode(graph, "file:src/app.ts");
  assertMissingNode(graph, "file:src/nested/model.generated.ts");
});

test("does not emit control-flow keywords as symbols across supported languages", async () => {
  const root = fixture({
    "src/app.ts": `
      export function validTs() {
        if (true) { return validJsHelper(); }
        for (const item of [1]) { validJsHelper(); }
        switch ("x") { case "x": return validJsHelper(); }
      }
      function validJsHelper() { return "ok"; }
    `,
    "src/app.py": `
def valid_py():
    if True:
        return "ok"
    for item in [1]:
        pass
`,
    "src/main.go": `package main
func validGo() string {
  if true { return "ok" }
  for i := 0; i < 1; i++ {}
  switch "x" { case "x": return "ok" }
  return "ok"
}
`,
    "src/lib.rs": `
pub fn valid_rust() -> String {
  if true { return "ok".to_string(); }
  for item in [1] { let _ = item; }
  match "x" { "x" => "ok".to_string(), _ => "no".to_string() }
}
`,
    "src/App.java": `
public class App {
  public String validJava() {
    if (true) { return "ok"; }
    for (int i = 0; i < 1; i++) {}
    switch ("x") { case "x": return "ok"; default: return "no"; }
  }
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:src/app.ts:validTs");
  assertNode(graph, "symbol:src/app.ts:validJsHelper");
  assertNode(graph, "symbol:src/app.py:valid_py");
  assertNode(graph, "symbol:src/main.go:validGo");
  assertNode(graph, "symbol:src/lib.rs:valid_rust");
  assertNode(graph, "symbol:src/App.java:App");
  assertNode(graph, "symbol:src/App.java:validJava");

  for (const keyword of ["if", "for", "switch", "while", "catch", "else", "do", "match"]) {
    assert.equal(
      graph.nodes.some(
        (node) => node.type !== "file" && node.type !== "module" && node.name === keyword,
      ),
      false,
      `unexpected control-flow symbol ${keyword}`,
    );
  }
});

test("writes graph runtime data to database without runtime json files", async () => {
  const root = fixture({
    "src/app.ts": `export function realSymbol() { return "ok"; }`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  writeGraph(root, graph);

  assert.equal(graphExists(root), true);
  assert.equal(existsSync(join(root, ".codegraph", "graph.db")), true);
  assert.equal(existsSync(join(root, ".codegraph", "graph.json")), false);
  assert.equal(existsSync(join(root, ".codegraph", "index.json")), false);
  assert.equal(existsSync(join(root, ".codegraph", "cache", "scan-cache.json")), false);
  assertNode(readGraph(root), "symbol:src/app.ts:realSymbol");
});

test("persists scan cache metadata used for unchanged fast path", async () => {
  const root = fixture({
    "src/app.ts": `export function cachedSymbol() { return "ok"; }`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  writeGraph(root, graph);

  const cache = readScanCache(root);
  const entry = cache.files["src/app.ts"];

  assert.equal(typeof entry.hash, "string");
  assert.equal(entry.hash.length, 64);
  assert.equal(typeof entry.mtime, "number");
  assert.equal(typeof entry.size, "number");
  assert.ok(entry.size !== undefined && entry.size > 0);
  assert.equal(entry.language, "typescript");
  assert.equal(typeof entry.scannerVersion, "string");
  assert.equal(
    entry.nodes.some((node) => node.id === "symbol:src/app.ts:cachedSymbol"),
    true,
  );
});

test("does not emit bare block calls as symbols", async () => {
  const root = fixture({
    "src/spec.ts": `
      describe("suite", () => {
        before(() => {});
        it("case", () => {});
      });
      export function realSymbol() {
        return "ok";
      }
    `,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  assertNode(graph, "symbol:src/spec.ts:realSymbol");
  assert.equal(
    graph.nodes.some((node) => node.name === "describe"),
    false,
  );
  assert.equal(
    graph.nodes.some((node) => node.name === "before"),
    false,
  );
  assert.equal(
    graph.nodes.some((node) => node.name === "it"),
    false,
  );
});

test("respects configured language allowlist", async () => {
  const root = fixture({
    "src/app.ts": `export function tsOnly() { return "ts"; }`,
    "src/app.py": `def py_only():
    return "py"
`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["python"] });

  assert.equal(graph.metadata.filesScanned, 1);
  assertNode(graph, "file:src/app.py");
  assertMissingNode(graph, "file:src/app.ts");
});

test("scanCodebase extracts TypeScript AST symbols without matching comments or strings", async () => {
  const root = fixture({
    "src/decorated.ts": `
// This is a comment with function stringOnly() {}
const stringContent = "function stringOnly() {}";
/* Block comment with function commentOnly() {} */

@Controller
export class UserController {
  listUsers() {
    return [];
  }
}

export const buildUser = () => ({
  name: "User",
});
`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  // Should include AST-extracted symbols
  assertNode(graph, "symbol:src/decorated.ts:UserController");
  assertNode(graph, "symbol:src/decorated.ts:UserController.listUsers");
  assertNode(graph, "symbol:src/decorated.ts:buildUser");

  // Should NOT include symbols from comments or strings
  assertMissingNode(graph, "symbol:src/decorated.ts:stringOnly");
  assertMissingNode(graph, "symbol:src/decorated.ts:commentOnly");
});

test("captures every Go parenthesized import", async () => {
  const root = fixture({
    "server.go": `package main
import (
  "fmt"
  "net/http"
)
func main() {
  fmt.Println(http.MethodGet)
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertEdge(graph, "imports", "file:server.go", "module:fmt");
  assertEdge(graph, "imports", "file:server.go", "module:net/http");
});

test("does not treat Go string literals as imports", async () => {
  const root = fixture({
    "server.go": `package main
import "net/http"
func main() {
  http.HandleFunc("/health", health)
}
func health(w http.ResponseWriter, r *http.Request) {}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertEdge(graph, "imports", "file:server.go", "module:net/http");
  assertMissingNode(graph, "module:/health");
});

test("scans JavaScript symbols, imports, and calls", async () => {
  const root = fixture({
    "src/user.js": `import { saveUser } from "./repo.js";
export function createUser(name) {
  return saveUser(name);
}
export class UserService {}
`,
    "src/repo.js": `export function saveUser(name) {
  return name;
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "file:src/user.js");
  assertNode(graph, "symbol:src/user.js:createUser");
  assertNode(graph, "symbol:src/user.js:UserService");
  assertEdge(graph, "imports", "file:src/user.js", "module:./repo.js");
  assertEdge(graph, "depends-on", "file:src/user.js", "file:src/repo.js");
  assertEdge(graph, "calls", "symbol:src/user.js:createUser", "symbol:src/repo.js:saveUser");
});

test("scans TypeScript classes, interfaces, imports, and calls", async () => {
  const root = fixture({
    "src/service.ts": `import { loadUser } from "./repo";
export interface UserPort {}
export class UserService {
  find(id: string) {
    return loadUser(id);
  }
}
`,
    "src/repo.ts": `export function loadUser(id: string) {
  return id;
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:src/service.ts:UserPort");
  assertNode(graph, "symbol:src/service.ts:UserService");
  assertNode(graph, "symbol:src/service.ts:UserService.find");
  assertEdge(graph, "imports", "file:src/service.ts", "module:./repo");
  assertEdge(graph, "depends-on", "file:src/service.ts", "file:src/repo.ts");
  assertEdge(
    graph,
    "calls",
    "symbol:src/service.ts:UserService.find",
    "symbol:src/repo.ts:loadUser",
  );
});

test("captures TypeScript type-only imports as module relationships", async () => {
  const root = fixture({
    "src/service.ts": `import type { User } from "./types";
export function readUser(user: User) {
  return user.id;
}
`,
    "src/types.ts": `export interface User { id: string }
`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  assertNode(graph, "file:src/types.ts");
  assertNode(graph, "symbol:src/types.ts:User");
  assertEdge(graph, "imports", "file:src/service.ts", "module:./types");
  assertEdge(graph, "depends-on", "file:src/service.ts", "file:src/types.ts");
  assert.deepEqual(graph.metadata.languages, ["typescript"]);
  assert.equal(graph.metadata.filesScanned, 2);
  assert.equal(graph.metadata.nodesCount, graph.nodes.length);
  assert.equal(graph.metadata.edgesCount, graph.edges.length);
  assert.equal(graph.metadata.nodeTypes?.file, 2);
  assert.equal(graph.metadata.edgeTypes?.imports, 1);
  assert.equal(typeof graph.metadata.relationshipCoverage, "number");
  assert.equal(typeof graph.metadata.qualityScore, "number");
});

test("scans Python classes, functions, imports, and calls", async () => {
  const root = fixture({
    "app/service.py": `from app.repo import load_user
class UserService:
    def find(self, user_id):
        return load_user(user_id)

def create_user(name):
    return name
`,
    "app/repo.py": `def load_user(user_id):
    return user_id
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:app/service.py:UserService");
  assertNode(graph, "symbol:app/service.py:find");
  assertNode(graph, "symbol:app/service.py:create_user");
  assertEdge(graph, "imports", "file:app/service.py", "module:app.repo");
  assertEdge(graph, "calls", "symbol:app/service.py:find", "symbol:app/repo.py:load_user");
});

test("scans Go functions, imports, and calls", async () => {
  const root = fixture({
    "main.go": `package main
import "example.com/app/repo"
func main() {
  repo.LoadUser("1")
}
`,
    "repo/repo.go": `package repo
func LoadUser(id string) string {
  return id
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:main.go:main");
  assertNode(graph, "symbol:repo/repo.go:LoadUser");
  assertEdge(graph, "imports", "file:main.go", "module:example.com/app/repo");
  assertEdge(graph, "calls", "symbol:main.go:main", "symbol:repo/repo.go:LoadUser");
});

test("scans Rust structs, functions, use imports, and calls", async () => {
  const root = fixture({
    "src/main.rs": `use crate::repo::load_user;
pub struct UserService;
fn main() {
  load_user("1");
}
`,
    "src/repo.rs": `pub fn load_user(id: &str) -> &str {
  id
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:src/main.rs:UserService");
  assertNode(graph, "symbol:src/main.rs:main");
  assertNode(graph, "symbol:src/repo.rs:load_user");
  assertEdge(graph, "imports", "file:src/main.rs", "module:crate::repo::load_user");
  assertEdge(graph, "calls", "symbol:src/main.rs:main", "symbol:src/repo.rs:load_user");
});

test("scans JavaScript components, arrow handlers, routes, and class inheritance", async () => {
  const root = fixture({
    "src/app.jsx": `import React from "react";
class BaseController {}
export class UserController extends BaseController {}
export const UserCard = ({ user }) => <Profile user={user} />;
const Profile = ({ user }) => <span>{user.name}</span>;
app.get("/users/:id", getUser);
const getUser = (req, res) => res.json(UserCard({ user: req.user }));
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:src/app.jsx:UserController");
  assertNode(graph, "symbol:src/app.jsx:UserCard");
  assertNode(graph, "symbol:src/app.jsx:Profile");
  assertNode(graph, "symbol:src/app.jsx:getUser");
  assertNode(graph, "route:src/app.jsx:/users/:id");
  assertEdge(
    graph,
    "extends",
    "symbol:src/app.jsx:UserController",
    "symbol:src/app.jsx:BaseController",
  );
  assertEdge(graph, "component-usage", "symbol:src/app.jsx:UserCard", "symbol:src/app.jsx:Profile");
  assertEdge(graph, "route-handler", "route:src/app.jsx:/users/:id", "symbol:src/app.jsx:getUser");
});

test("deduplicates repeated route nodes", async () => {
  const root = fixture({
    "src/routes.js": `app.get("/users", listUsers);
app.get("/users", getUsers);
function listUsers() {}
function getUsers() {}
`,
  });

  const graph = await scanCodebase(root, settings);

  assert.equal(graph.nodes.filter((node) => node.id === "route:src/routes.js:/users").length, 1);
  assertEdge(
    graph,
    "route-handler",
    "route:src/routes.js:/users",
    "symbol:src/routes.js:listUsers",
  );
  assertEdge(graph, "route-handler", "route:src/routes.js:/users", "symbol:src/routes.js:getUsers");
});

test("scans TypeScript decorators, implements, components, and async handlers", async () => {
  const root = fixture({
    "src/controller.tsx": `interface UserPort {}
abstract class BaseController {}
@Controller("/users")
export class UserController extends BaseController implements UserPort {
  async getUser(id: string) {
    return fetchUser(id);
  }
}
export const UserPanel = () => <UserCard />;
function UserCard() { return <div />; }
function fetchUser(id: string) { return id; }
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:src/controller.tsx:UserController");
  assertNode(graph, "symbol:src/controller.tsx:UserController.getUser");
  assertNode(graph, "symbol:src/controller.tsx:UserPanel");
  assertNode(graph, "route:src/controller.tsx:/users");
  assertEdge(
    graph,
    "extends",
    "symbol:src/controller.tsx:UserController",
    "symbol:src/controller.tsx:BaseController",
  );
  assertEdge(
    graph,
    "implements",
    "symbol:src/controller.tsx:UserController",
    "symbol:src/controller.tsx:UserPort",
  );
  assertEdge(
    graph,
    "calls",
    "symbol:src/controller.tsx:UserController.getUser",
    "symbol:src/controller.tsx:fetchUser",
  );
  assertEdge(
    graph,
    "component-usage",
    "symbol:src/controller.tsx:UserPanel",
    "symbol:src/controller.tsx:UserCard",
  );
});

test("scans Python async functions, decorated routes, and method calls", async () => {
  const root = fixture({
    "app/api.py": `from app.service import UserService
@app.get("/users/{user_id}")
async def get_user(user_id):
    service = UserService()
    return await service.find(user_id)

class UserService:
    async def find(self, user_id):
        return user_id
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:app/api.py:get_user");
  assertNode(graph, "symbol:app/api.py:find");
  assertNode(graph, "route:app/api.py:/users/{user_id}");
  assertEdge(
    graph,
    "route-handler",
    "route:app/api.py:/users/{user_id}",
    "symbol:app/api.py:get_user",
  );
  assertEdge(graph, "calls", "symbol:app/api.py:get_user", "symbol:app/api.py:find");
});

test("scans Go interfaces, methods, route handlers, and method calls", async () => {
  const root = fixture({
    "server.go": `package main
import "net/http"
type UserStore interface { Find(id string) string }
type UserHandler struct{}
func (h UserHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
  h.Find("1")
}
func (h UserHandler) Find(id string) string { return id }
func main() {
  http.HandleFunc("/users", UserHandler{}.ServeHTTP)
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:server.go:UserStore");
  assertNode(graph, "symbol:server.go:UserHandler");
  assertNode(graph, "symbol:server.go:ServeHTTP");
  assertNode(graph, "symbol:server.go:Find");
  assertNode(graph, "route:server.go:/users");
  assertEdge(graph, "route-handler", "route:server.go:/users", "symbol:server.go:ServeHTTP");
  assertEdge(graph, "calls", "symbol:server.go:ServeHTTP", "symbol:server.go:Find");
});

test("scans Java classes, interfaces, imports, annotations, inheritance, and calls", async () => {
  const root = fixture({
    "src/main/java/com/example/UserController.java": `package com.example;
import com.example.repo.UserRepository;
interface UserPort { String getUser(String id); }
class BaseController {}
@RestController
@RequestMapping("/users")
public class UserController extends BaseController implements UserPort {
  private final UserRepository repo = new UserRepository();
  @GetMapping("/{id}")
  public String getUser(String id) {
    return repo.loadUser(id);
  }
}
`,
    "src/main/java/com/example/repo/UserRepository.java": `package com.example.repo;
public class UserRepository {
  public String loadUser(String id) {
    return id;
  }
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "file:src/main/java/com/example/UserController.java");
  assertNode(graph, "symbol:src/main/java/com/example/UserController.java:UserPort");
  assertNode(graph, "symbol:src/main/java/com/example/UserController.java:BaseController");
  assertNode(graph, "symbol:src/main/java/com/example/UserController.java:UserController");
  assertNode(graph, "symbol:src/main/java/com/example/UserController.java:getUser");
  assertNode(graph, "symbol:src/main/java/com/example/repo/UserRepository.java:UserRepository");
  assertNode(graph, "symbol:src/main/java/com/example/repo/UserRepository.java:loadUser");
  assertNode(graph, "route:src/main/java/com/example/UserController.java:/users");
  assertNode(graph, "route:src/main/java/com/example/UserController.java:/users/{id}");
  assertEdge(
    graph,
    "imports",
    "file:src/main/java/com/example/UserController.java",
    "module:com.example.repo.UserRepository",
  );
  assertEdge(
    graph,
    "extends",
    "symbol:src/main/java/com/example/UserController.java:UserController",
    "symbol:src/main/java/com/example/UserController.java:BaseController",
  );
  assertEdge(
    graph,
    "implements",
    "symbol:src/main/java/com/example/UserController.java:UserController",
    "symbol:src/main/java/com/example/UserController.java:UserPort",
  );
  assertEdge(
    graph,
    "route-handler",
    "route:src/main/java/com/example/UserController.java:/users/{id}",
    "symbol:src/main/java/com/example/UserController.java:getUser",
  );
  assertEdge(
    graph,
    "calls",
    "symbol:src/main/java/com/example/UserController.java:getUser",
    "symbol:src/main/java/com/example/repo/UserRepository.java:loadUser",
  );
});

test("joins Java class and method routes without duplicate slashes", async () => {
  const root = fixture({
    "src/main/java/com/example/UserController.java": `package com.example;
@RestController
@RequestMapping("/api/")
public class UserController {
  @GetMapping("/users")
  public String listUsers() { return "ok"; }
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "route:src/main/java/com/example/UserController.java:/api/users");
  assertEdge(
    graph,
    "route-handler",
    "route:src/main/java/com/example/UserController.java:/api/users",
    "symbol:src/main/java/com/example/UserController.java:listUsers",
  );
});

test("scans Rust traits, impl methods, enums, and associated calls", async () => {
  const root = fixture({
    "src/lib.rs": `pub trait Repository { fn load(&self, id: &str) -> String; }
pub enum UserState { Active }
pub struct UserRepo;
impl Repository for UserRepo {
  fn load(&self, id: &str) -> String { id.to_string() }
}
pub fn handle(repo: UserRepo) -> String {
  repo.load("1")
}
`,
  });

  const graph = await scanCodebase(root, settings);

  assertNode(graph, "symbol:src/lib.rs:Repository");
  assertNode(graph, "symbol:src/lib.rs:UserState");
  assertNode(graph, "symbol:src/lib.rs:UserRepo");
  assertNode(graph, "symbol:src/lib.rs:load");
  assertNode(graph, "symbol:src/lib.rs:handle");
  assertEdge(graph, "implements", "symbol:src/lib.rs:UserRepo", "symbol:src/lib.rs:Repository");
  assertEdge(graph, "calls", "symbol:src/lib.rs:handle", "symbol:src/lib.rs:load");
});

test("ignores symbols, imports, and calls inside JavaScript comments and strings", async () => {
  const root = fixture({
    "src/app.ts": `
      import { realTarget } from "./real";
      // import fakeModule from "fake-module";
      // function fakeCommentSymbol() {}
      const text = "fakeStringCall() import nope from 'bad'";
      export function realHandler() {
        realTarget();
      }
    `,
    "src/real.ts": `
      export function realTarget() {}
    `,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  assert.equal(
    graph.nodes.some((node) => node.name === "fakeCommentSymbol"),
    false,
  );
  assert.equal(
    graph.nodes.some((node) => node.id.includes("fake-module")),
    false,
  );
  assert.equal(
    graph.nodes.some((node) => node.id.includes("bad")),
    false,
  );
  assert.equal(
    graph.edges.some((edge) => edge.evidence === "fakeStringCall"),
    false,
  );
  assert.equal(
    graph.edges.some((edge) => edge.type === "calls" && edge.evidence === "realTarget"),
    true,
  );
});

test("ignores calls inside Python comments and strings", async () => {
  const root = fixture({
    "app.py": `
# def fake_comment_symbol(): pass
# fake_call()
text = "fake_string_call()"

def real_target():
    pass

def real_handler():
    real_target()
`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["python"] });

  assert.equal(
    graph.nodes.some((node) => node.name === "fake_comment_symbol"),
    false,
  );
  assert.equal(
    graph.edges.some((edge) => edge.evidence === "fake_call"),
    false,
  );
  assert.equal(
    graph.edges.some((edge) => edge.evidence === "fake_string_call"),
    false,
  );
  assert.equal(
    graph.edges.some((edge) => edge.type === "calls" && edge.evidence === "real_target"),
    true,
  );
});

test("escapes DOT, Mermaid, and HTML exports", async () => {
  const root = fixture({});
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-19T00:00:00.000Z",
    root,
    nodes: [
      {
        id: 'file:src/evil.ts"; bad',
        type: "file" as const,
        name: "evil</script>",
        path: "src/evil.ts",
      },
      { id: "symbol:target", type: "function" as const, name: "target", path: "src/evil.ts" },
    ],
    edges: [
      {
        id: "calls:file:src/evil.ts->symbol:target",
        type: "calls" as const,
        source: 'file:src/evil.ts"; bad',
        target: "symbol:target",
        evidence: 'x"] ; bad',
      },
    ],
    metadata: { languages: ["typescript"], filesScanned: 1, ignoredPaths: [] },
  };

  exportGraph(root, graph, ["dot", "mermaid", "html"]);

  const dot = readFileSync(join(root, ".codegraph", "exports", "graph.dot"), "utf8");
  const mermaid = readFileSync(join(root, ".codegraph", "exports", "graph.mmd"), "utf8");
  const html = readFileSync(join(root, ".codegraph", "exports", "graph.html"), "utf8");

  assert.match(dot, /\\"; bad/);
  assert.equal(dot.includes('"file:src/evil.ts"; bad" ->'), false);
  assert.equal(mermaid.includes('x"] ; bad'), false);
  assert.equal(html.includes("evil</script>"), false);
  assert.match(html, /evil\\u003c\/script\\u003e/);
});

test("hooks scan missing graph and update after file changes and stop events", async () => {
  const hooks = JSON.parse(readFileSync(join(process.cwd(), "hooks", "hooks.json"), "utf8"));
  const postToolUseHook = hooks.hooks.PostToolUse[0];

  // Write|Edit|MultiEdit|NotebookEdit matcher for post-tool-use graph updates
  assert.equal(postToolUseHook.matcher, "Write|Edit|MultiEdit|NotebookEdit");
  // Stop hook performs graph update with error logging
  assert.ok(hooks.hooks.Stop[0].hooks[1].async === true);
});

test("MCP server command resolves from PATH", async () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), ".mcp.json"), "utf8"));
  // CLI binary name (coder-workflow) or fallback (codegraph-mapper) both accepted
  const cmd = config.mcpServers.codegraph.command;
  assert.ok(
    cmd === "coder-workflow" || cmd === "codegraph-mapper",
    `Unexpected MCP command: ${cmd}`,
  );
  assert.equal(config.mcpServers.codegraph.args[0], "mcp");
});

test("analyzes graph quality issues and recommendations", async () => {
  const root = fixture({
    "src/app.ts": `import { missingTarget } from "./missing";
export function duplicateName() {
  return missingTarget();
}
`,
    "src/other.ts": `export function duplicateName() {
  return "other";
}
`,
    "src/index.ts": `export { duplicateName as firstDuplicate } from "./app";
export { duplicateName as secondDuplicate } from "./other";
`,
    "src/isolated.ts": `export function isolated() {
  return "isolated";
}
`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  const report = analyzeGraphQuality(graph, root);

  assert.equal(report.summary.issueCount > 0, true);
  assert.equal(
    report.issues.some(
      (issue: GraphQualityIssue) =>
        issue.category === "unresolved-import" && issue.evidence === "./missing",
    ),
    true,
  );
  assert.equal(
    report.issues.some(
      (issue: GraphQualityIssue) =>
        issue.category === "duplicate-symbol" && issue.evidence === "duplicateName",
    ),
    true,
  );
  assert.equal(
    report.issues.some((issue: GraphQualityIssue) => issue.category === "coverage"),
    true,
  );
  assert.equal(report.recommendations.length > 0, true);
});

test("ignores non-exported duplicate helper symbols in graph quality", async () => {
  const root = fixture({
    "src/app.ts": `export function app() {
  function sharedHelper() {
    return "app";
  }
  return sharedHelper();
}
`,
    "src/other.ts": `export function other() {
  function sharedHelper() {
    return "other";
  }
  return sharedHelper();
}
`,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  const report = analyzeGraphQuality(graph, root);

  assert.equal(
    report.issues.some(
      (issue: GraphQualityIssue) =>
        issue.category === "duplicate-symbol" && issue.evidence === "sharedHelper",
    ),
    false,
  );
});

test("evaluates quality gate thresholds by severity", async () => {
  const highOnly = evaluateQualityGate(
    [{ severity: "medium", category: "coverage", message: "coverage" }],
    "high",
  );
  assert.deepEqual(highOnly, { failedThreshold: "high", wouldFail: false });

  const mediumGate = evaluateQualityGate(
    [{ severity: "medium", category: "coverage", message: "coverage" }],
    "medium",
  );
  assert.deepEqual(mediumGate, { failedThreshold: "medium", wouldFail: true });

  const lowGate = evaluateQualityGate(
    [{ severity: "low", category: "coverage", message: "coverage" }],
    "low",
  );
  assert.deepEqual(lowGate, { failedThreshold: "low", wouldFail: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "codegraph-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

function assertNode(graph: CodeGraph, id: string): void {
  assert.ok(
    graph.nodes.some((node) => node.id === id),
    `missing node ${id}`,
  );
}

function assertMissingNode(graph: CodeGraph, id: string): void {
  assert.ok(!graph.nodes.some((node) => node.id === id), `unexpected node ${id}`);
}

function assertEdge(graph: CodeGraph, type: string, source: string, target: string): void {
  assert.ok(
    graph.edges.some(
      (edge) => edge.type === type && edge.source === source && edge.target === target,
    ),
    `missing edge ${type}:${source}->${target}`,
  );
}

test("resolves 'this' and 'self' method calls locally", async () => {
  const root = fixture({
    "src/service.ts": `
      export class UserService {
        find(id: string) {
          return this.loadUser(id);
        }
        loadUser(id: string) {
          return id;
        }
      }
    `,
  });

  const graph = await scanCodebase(root, settings);
  assertNode(graph, "symbol:src/service.ts:UserService.find");
  assertNode(graph, "symbol:src/service.ts:UserService.loadUser");
  assertEdge(
    graph,
    "calls",
    "symbol:src/service.ts:UserService.find",
    "symbol:src/service.ts:UserService.loadUser",
  );
});

test("prevents qualified calls to external library (console.log) from generating false positive calls", async () => {
  const root = fixture({
    "src/service.ts": `
      export function log(msg: string) {}
      export function run() {
        console.log("hello");
      }
    `,
  });

  const graph = await scanCodebase(root, settings);
  assert.equal(
    graph.edges.some(
      (edge) =>
        edge.source === "symbol:src/service.ts:run" && edge.target === "symbol:src/service.ts:log",
    ),
    false,
  );
});

test("calculates transitive impact analysis up to maxDepth", async () => {
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-19T00:00:00.000Z",
    root: "/root",
    nodes: [
      { id: "symbol:A", type: "function" as const, name: "A", path: "src/a.ts" },
      { id: "symbol:B", type: "function" as const, name: "B", path: "src/b.ts" },
      { id: "symbol:C", type: "function" as const, name: "C", path: "src/c.ts" },
      { id: "symbol:D", type: "function" as const, name: "D", path: "src/d.ts" },
    ],
    edges: [
      { id: "calls:A->B", type: "calls" as const, source: "symbol:A", target: "symbol:B" },
      { id: "calls:B->C", type: "calls" as const, source: "symbol:B", target: "symbol:C" },
      { id: "calls:C->D", type: "calls" as const, source: "symbol:C", target: "symbol:D" },
    ],
    metadata: { languages: ["typescript"], filesScanned: 4, ignoredPaths: [] },
  };

  const impact = analyzeImpact(graph, "symbol:C", 2);
  assert.ok(impact.upstreamVisited["symbol:B"] === 1);
  assert.ok(impact.upstreamVisited["symbol:A"] === 2);
  assert.ok(impact.downstreamVisited["symbol:D"] === 1);

  const impactDepth1 = analyzeImpact(graph, "symbol:C", 1);
  assert.equal(impactDepth1.upstreamVisited["symbol:A"], undefined);
});

test("calculates impact through production relationships without traversing exports", async () => {
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-19T00:00:00.000Z",
    root: "/root",
    nodes: [
      { id: "file:src/api.ts", type: "file" as const, name: "api.ts", path: "src/api.ts" },
      {
        id: "symbol:src/api.ts:handler",
        type: "function" as const,
        name: "handler",
        path: "src/api.ts",
      },
      {
        id: "symbol:src/service.ts:run",
        type: "function" as const,
        name: "run",
        path: "src/service.ts",
      },
      {
        id: "symbol:src/repo.ts:load",
        type: "function" as const,
        name: "load",
        path: "src/repo.ts",
      },
    ],
    edges: [
      {
        id: "exports:api->handler",
        type: "exports" as const,
        source: "file:src/api.ts",
        target: "symbol:src/api.ts:handler",
      },
      {
        id: "route-handler:/users->handler",
        type: "route-handler" as const,
        source: "route:/users",
        target: "symbol:src/api.ts:handler",
      },
      {
        id: "calls:handler->run",
        type: "calls" as const,
        source: "symbol:src/api.ts:handler",
        target: "symbol:src/service.ts:run",
      },
      {
        id: "calls:run->load",
        type: "calls" as const,
        source: "symbol:src/service.ts:run",
        target: "symbol:src/repo.ts:load",
      },
    ],
    metadata: { languages: ["typescript"], filesScanned: 3, ignoredPaths: [] },
  };

  const impact = analyzeImpact(graph, "handler", 3);

  assert.equal(impact.downstreamVisited["symbol:src/service.ts:run"], 1);
  assert.equal(impact.downstreamVisited["symbol:src/repo.ts:load"], 2);
  assert.equal(impact.upstreamVisited["route:/users"], 1);
  assert.equal(impact.upstreamVisited["file:src/api.ts"], undefined);
  assert.equal(
    impact.directUpstream.some((edge) => edge.type === "exports"),
    true,
  );
});

test("finds cycles without duplication and normalizes path rotations", async () => {
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-19T00:00:00.000Z",
    root: "/root",
    nodes: [
      { id: "file:A", type: "file" as const, name: "A", path: "src/a.ts" },
      { id: "file:B", type: "file" as const, name: "B", path: "src/b.ts" },
      { id: "file:C", type: "file" as const, name: "C", path: "src/c.ts" },
    ],
    edges: [
      { id: "imports:A->B", type: "imports" as const, source: "file:A", target: "file:B" },
      { id: "imports:B->C", type: "imports" as const, source: "file:B", target: "file:C" },
      { id: "imports:C->A", type: "imports" as const, source: "file:C", target: "file:A" },
    ],
    metadata: { languages: ["typescript"], filesScanned: 3, ignoredPaths: [] },
  };

  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ["file:A", "file:B", "file:C"]);
});

test("precisely detects file and symbol orphans", async () => {
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-19T00:00:00.000Z",
    root: "/root",
    nodes: [
      { id: "file:src/main.ts", type: "file" as const, name: "main.ts", path: "src/main.ts" },
      { id: "file:src/orphan.ts", type: "file" as const, name: "orphan.ts", path: "src/orphan.ts" },
      {
        id: "symbol:src/main.ts:main",
        type: "function" as const,
        name: "main",
        path: "src/main.ts",
      },
      {
        id: "symbol:src/main.ts:helper",
        type: "function" as const,
        name: "helper",
        path: "src/main.ts",
      },
      {
        id: "symbol:src/main.ts:dead",
        type: "function" as const,
        name: "dead",
        path: "src/main.ts",
      },
    ],
    edges: [
      {
        id: "imports:main->something",
        type: "imports" as const,
        source: "file:src/main.ts",
        target: "module:src/main.ts",
      },
      {
        id: "calls:main->helper",
        type: "calls" as const,
        source: "symbol:src/main.ts:main",
        target: "symbol:src/main.ts:helper",
      },
    ],
    metadata: { languages: ["typescript"], filesScanned: 2, ignoredPaths: [] },
  };

  const orphans = findOrphans(graph);
  const orphanFile = orphans.find((o) => o.orphanType === "file");
  const orphanSymbol = orphans.find((o) => o.orphanType === "symbol");

  assert.ok(orphanFile);
  assert.equal(orphanFile.id, "file:src/orphan.ts");
  assert.ok(orphanSymbol);
  assert.equal(orphanSymbol.id, "symbol:src/main.ts:dead");
});

test("does not report exported public symbols or entry-like files as orphans", async () => {
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-19T00:00:00.000Z",
    root: "/root",
    nodes: [
      { id: "file:src/index.ts", type: "file" as const, name: "index.ts", path: "src/index.ts" },
      { id: "file:src/api.ts", type: "file" as const, name: "api.ts", path: "src/api.ts" },
      { id: "file:src/unused.ts", type: "file" as const, name: "unused.ts", path: "src/unused.ts" },
      {
        id: "symbol:src/api.ts:publicApi",
        type: "function" as const,
        name: "publicApi",
        path: "src/api.ts",
      },
      {
        id: "symbol:src/unused.ts:dead",
        type: "function" as const,
        name: "dead",
        path: "src/unused.ts",
      },
    ],
    edges: [
      {
        id: "exports:index->publicApi",
        type: "exports" as const,
        source: "file:src/index.ts",
        target: "symbol:src/api.ts:publicApi",
      },
    ],
    metadata: { languages: ["typescript"], filesScanned: 3, ignoredPaths: [] },
  };

  const orphans = findOrphans(graph);

  assert.equal(
    orphans.some((node) => node.id === "file:src/index.ts"),
    false,
  );
  assert.equal(
    orphans.some((node) => node.id === "symbol:src/api.ts:publicApi"),
    false,
  );
  assert.equal(
    orphans.some((node) => node.id === "file:src/unused.ts"),
    true,
  );
  assert.equal(
    orphans.some((node) => node.id === "symbol:src/unused.ts:dead"),
    true,
  );
});

test("resolves extensionless local imports and directory index imports for JS/TS calls", async () => {
  const root = fixture({
    "src/index.ts": `
      import { runHelper } from "./helpers";
      import { doWork } from "./utils/worker";
      export function main() {
        runHelper();
        doWork();
      }
    `,
    "src/helpers/index.ts": `
      export function runHelper() { return "helper"; }
    `,
    "src/utils/worker.ts": `
      export function doWork() { return "work"; }
    `,
  });

  const graph = await scanCodebase(root, settings);
  assertNode(graph, "symbol:src/index.ts:main");
  assertNode(graph, "symbol:src/helpers/index.ts:runHelper");
  assertNode(graph, "symbol:src/utils/worker.ts:doWork");

  assertEdge(graph, "calls", "symbol:src/index.ts:main", "symbol:src/helpers/index.ts:runHelper");
  assertEdge(graph, "calls", "symbol:src/index.ts:main", "symbol:src/utils/worker.ts:doWork");
});

test("reuses unchanged scan cache entries without parsing", async () => {
  const root = fixture({
    "src/a.ts": `export function a() { return "a"; }`,
    "src/b.ts": `export function b() { return a(); }`,
  });
  const seen: string[] = [];

  await scanCodebase(root, {
    ...settings,
    languages: ["typescript"],
    onParseFile: (path) => seen.push(path),
  });
  assert.deepEqual(seen.sort(), ["src/a.ts", "src/b.ts"]);

  seen.length = 0;
  const graph = await scanCodebase(root, {
    ...settings,
    languages: ["typescript"],
    onParseFile: (path) => seen.push(path),
  });

  assert.deepEqual(seen, []);
  assertNode(graph, "symbol:src/a.ts:a");
  assertNode(graph, "symbol:src/b.ts:b");
});

test("reparses only changed files on repeated scans", async () => {
  const root = fixture({
    "src/a.ts": `export function a() { return "a"; }`,
    "src/b.ts": `export function b() { return a(); }`,
  });
  const seen: string[] = [];

  await scanCodebase(root, {
    ...settings,
    languages: ["typescript"],
    onParseFile: (path) => seen.push(path),
  });
  seen.length = 0;

  writeFileSync(join(root, "src/a.ts"), `export function aChanged() { return "changed"; }`);
  const graph = await scanCodebase(root, {
    ...settings,
    languages: ["typescript"],
    onParseFile: (path) => seen.push(path),
  });

  assert.deepEqual(seen, ["src/a.ts"]);
  assertNode(graph, "symbol:src/a.ts:aChanged");
  assertMissingNode(graph, "symbol:src/a.ts:a");
  assertNode(graph, "symbol:src/b.ts:b");
});

test("keeps cross-file call relationships when unchanged files reuse cache", async () => {
  const root = fixture({
    "src/a.ts": `export function a() { return "a"; }`,
    "src/b.ts": `import { a } from "./a"; export function b() { return a(); }`,
  });

  await scanCodebase(root, { ...settings, languages: ["typescript"] });
  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  assertEdge(graph, "depends-on", "file:src/b.ts", "file:src/a.ts");
  assertEdge(graph, "calls", "symbol:src/b.ts:b", "symbol:src/a.ts:a");
});

test("removes deleted files from incremental graph", async () => {
  const root = fixture({
    "src/a.ts": `export function a() { return "a"; }`,
    "src/b.ts": `import { a } from "./a"; export function b() { return a(); }`,
  });

  await scanCodebase(root, { ...settings, languages: ["typescript"] });
  rmSync(join(root, "src/a.ts"));

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });

  assertMissingNode(graph, "file:src/a.ts");
  assertMissingNode(graph, "symbol:src/a.ts:a");
  assertNode(graph, "file:src/b.ts");
  assert.equal(
    graph.edges.some(
      (edge) => edge.source.includes("src/a.ts") || edge.target.includes("src/a.ts"),
    ),
    false,
  );
});

test("path-scoped database replacement preserves unrelated graph rows", async () => {
  const root = fixture({
    "src/a.ts": `import { b } from "./b"; export function a() { return b(); }`,
    "src/b.ts": `export function b() { return "b"; }`,
  });
  const first = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  writeGraph(root, first);

  const second = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  const replacementNodes = second.nodes.filter((node) => node.path === "src/a.ts");
  const replacementEdges = second.edges.filter(
    (edge) => edge.source.includes("src/a.ts") || edge.target.includes("src/a.ts"),
  );

  replaceGraphPathsInDb(root, second, ["src/a.ts"], replacementNodes, replacementEdges);
  const stored = readGraph(root);

  assertNode(stored, "symbol:src/a.ts:a");
  assertNode(stored, "symbol:src/b.ts:b");
});

test("scanCodebase extracts AST imports from multiline and destructured TypeScript imports", async () => {
  const root = fixture({
    "src/shared.ts": "export const auth = () => true; export const log = () => undefined;",
    "src/app.ts": `
      import {
        auth,
        log as writeLog,
      } from "./shared.js";

      export function run() {
        writeLog();
        return auth();
      }
    `,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  assert.ok(graph.edges.some((edge) => edge.type === "imports" && edge.evidence === "./shared.js"));
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.type === "depends-on" &&
        edge.source.endsWith("src/app.ts") &&
        edge.target.endsWith("src/shared.ts"),
    ),
  );
});

test("HTML export includes interactive viewer controls", async () => {
  const root = fixture({});
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-20T00:00:00.000Z",
    root,
    nodes: [
      {
        id: "file:src/app.ts",
        type: "file" as const,
        name: "app.ts",
        path: "src/app.ts",
        language: "typescript",
      },
      {
        id: "symbol:src/app.ts:handler",
        type: "function" as const,
        name: "handler",
        path: "src/app.ts",
        language: "typescript",
      },
    ],
    edges: [
      {
        id: "exports:file:src/app.ts->symbol:src/app.ts:handler",
        type: "exports" as const,
        source: "file:src/app.ts",
        target: "symbol:src/app.ts:handler",
        evidence: "handler",
      },
    ],
    metadata: { languages: ["typescript"], filesScanned: 1, ignoredPaths: [] },
  };

  exportGraph(root, graph, ["html"]);

  const html = readFileSync(join(root, ".codegraph", "exports", "graph.html"), "utf8");
  assert.match(html, /id="search"/);
  assert.match(html, /id="typeFilter"/);
  assert.match(html, /id="nodeDetails"/);
  assert.match(html, /id="edgeList"/);
  assert.match(html, /function render\(\)/);
  assert.equal(html.includes("window.__CODEGRAPH__"), true);
});

test("html export safely embeds interactive graph data and script-like strings", async () => {
  const root = fixture({});
  const graph = {
    version: "0.1.0" as const,
    generatedAt: "2026-05-24T00:00:00.000Z",
    root,
    nodes: [
      {
        id: "file:x.ts",
        type: "file" as const,
        name: "</script><script>alert(1)</script>",
        path: "x.ts",
        language: "typescript",
      },
      {
        id: "symbol:x.ts:foo",
        type: "function" as const,
        name: "foo",
        path: "x.ts",
        language: "typescript",
        startLine: 5,
        endLine: 10,
      },
    ],
    edges: [],
    metadata: {
      filesScanned: 1,
      nodesCount: 2,
      edgesCount: 0,
      languages: ["typescript"],
      ignoredPaths: [],
      nodeTypes: {},
      edgeTypes: {},
      relationshipCoverage: 1,
      qualityScore: 1,
    },
  };

  exportGraph(root, graph, ["html"]);

  const html = readFileSync(join(root, ".codegraph", "exports", "graph.html"), "utf8");
  assert.match(html, /window\.__CODEGRAPH__/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /startLine/);
  assert.match(html, /endLine/);
});

test("call graph records confidence for ambiguous same-name methods", async () => {
  const root = fixture({
    "src/app.ts": `
      export function save() { return "user"; }
      export function save() { return "audit"; }
      export function run() { return save(); }
    `,
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  const saveEdges = graph.edges.filter((edge) => edge.type === "calls" && edge.evidence === "save");
  assert.ok(saveEdges.length >= 1);
  assert.ok(saveEdges.every((edge) => typeof edge.confidence === "number"));
});

test("scanCodebase resolves workspace package imports as internal dependencies", async () => {
  const root = fixture({
    "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    "packages/shared/package.json": JSON.stringify({ name: "@acme/shared" }),
    "packages/shared/src/index.ts": "export function auth() { return true; }",
    "packages/app/src/index.ts": "import { auth } from '@acme/shared'; export const ok = auth();",
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  assert.ok(
    graph.edges.some((edge) => edge.type === "depends-on" && edge.evidence === "@acme/shared"),
  );
});

test("scanCodebase resolves tsconfig path aliases as internal dependencies", async () => {
  const root = fixture({
    "tsconfig.json": JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@shared/*": ["src/shared/*"] } },
    }),
    "src/shared/auth.ts": "export function auth() { return true; }",
    "src/app.ts": "import { auth } from '@shared/auth'; export const ok = auth();",
  });

  const graph = await scanCodebase(root, { ...settings, languages: ["typescript"] });
  assert.ok(
    graph.edges.some((edge) => edge.type === "depends-on" && edge.evidence === "@shared/auth"),
  );
});
