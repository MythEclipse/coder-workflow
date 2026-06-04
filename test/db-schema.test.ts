import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compareSchemas,
  formatSchemaDiff,
  formatSchemaReport,
  parsePrismaSchema,
} from "../src/db-schema.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "db-schema-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("parsePrismaSchema parses a single model with scalar fields", () => {
  const root = fixture({
    "schema.prisma": `model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  assert.equal(report.totalEntities, 1);
  assert.equal(report.entities[0].name, "User");
  assert.equal(report.entities[0].fields.length, 4);

  const idField = report.entities[0].fields.find((f) => f.name === "id");
  assert.ok(idField);
  assert.equal(idField!.type, "integer");
  assert.equal(idField!.required, true);

  const emailField = report.entities[0].fields.find((f) => f.name === "email");
  assert.ok(emailField);
  assert.equal(emailField!.unique, true);

  const nameField = report.entities[0].fields.find((f) => f.name === "name");
  assert.ok(nameField);
  assert.equal(nameField!.required, false);
});

test("parsePrismaSchema parses multiple models with relations", () => {
  const root = fixture({
    "schema.prisma": `model User {
  id    Int  @id @default(autoincrement())
}

model Post {
  id     Int  @id @default(autoincrement())
  author User @relation(fields: [authorId], references: [id])
  authorId Int
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  assert.equal(report.totalEntities, 2);
  assert.equal(report.totalRelations, 1);

  const user = report.entities.find((e) => e.name === "User");
  assert.ok(user);

  const post = report.entities.find((e) => e.name === "Post");
  assert.ok(post);
  assert.ok(post!.relations.includes("User"));
});

test("parsePrismaSchema handles composite primary key with @@id", () => {
  const root = fixture({
    "schema.prisma": `model PostTag {
  postId Int
  tagId  Int
  @@id([postId, tagId])
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  assert.equal(report.totalEntities, 1);
  const entity = report.entities[0];
  assert.deepEqual(entity.primaryKey, ["postId", "tagId"]);
});

test("parsePrismaSchema handles @@index directives", () => {
  const root = fixture({
    "schema.prisma": `model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  @@index([email])
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  assert.equal(report.totalEntities, 1);
  assert.equal(report.entities[0].indexes.length, 1);
  assert.match(report.entities[0].indexes[0], /email/);
});

test("parsePrismaSchema returns error for missing file", () => {
  const report = parsePrismaSchema("/nonexistent/schema.prisma");
  assert.equal(report.totalEntities, 0);
  assert.ok(report.error);
  assert.match(report.error!, /not found/);
});

test("parsePrismaSchema handles empty file", () => {
  const root = fixture({
    "schema.prisma": "",
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  assert.equal(report.totalEntities, 0);
  assert.equal(report.totalRelations, 0);
});

test("parsePrismaSchema skips enum blocks", () => {
  const root = fixture({
    "schema.prisma": `enum Role {
  USER
  ADMIN
}

model User {
  id   Int  @id @default(autoincrement())
  role Role
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  assert.equal(report.totalEntities, 1);
  assert.equal(report.entities[0].name, "User");
});

test("formatSchemaReport shows entity count and relations", () => {
  const root = fixture({
    "schema.prisma": `model User {
  id Int @id
}
model Post {
  id Int @id
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  const output = formatSchemaReport(report);
  assert.match(output, /2 entities/);
  assert.match(output, /User/);
  assert.match(output, /Post/);
  assert.match(output, /Schema Report/);
});

test("formatSchemaReport shows error message when report has error", () => {
  const report = {
    entities: [],
    totalEntities: 0,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
    error: "File not found: /bad/path",
  };

  const output = formatSchemaReport(report);
  assert.match(output, /Schema Report Error/);
  assert.match(output, /not found/);
});

test("compareSchemas detects added entities", () => {
  const before = {
    entities: [],
    totalEntities: 0,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };

  const after = {
    entities: [
      {
        name: "User",
        table: "User",
        fields: [{ name: "id", type: "integer", required: true, unique: true }],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    totalEntities: 1,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };

  const diff = compareSchemas(before, after);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].name, "User");
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 0);
});

test("compareSchemas detects removed entities", () => {
  const before = {
    entities: [
      {
        name: "OldModel",
        table: "OldModel",
        fields: [{ name: "id", type: "integer", required: true, unique: true }],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    totalEntities: 1,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };
  const after = {
    entities: [],
    totalEntities: 0,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };

  const diff = compareSchemas(before, after);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].name, "OldModel");
  assert.equal(diff.added.length, 0);
});

test("compareSchemas detects changed fields (type change)", () => {
  const before = {
    entities: [
      {
        name: "User",
        table: "User",
        fields: [{ name: "id", type: "integer", required: true, unique: true }],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    totalEntities: 1,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };
  const after = {
    entities: [
      {
        name: "User",
        table: "User",
        fields: [{ name: "id", type: "string", required: true, unique: true }],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    totalEntities: 1,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };

  const diff = compareSchemas(before, after);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].fieldChanges.length, 1);
  assert.equal(diff.changed[0].fieldChanges[0].change, "type changed");
});

test("compareSchemas detects removable fields", () => {
  const before = {
    entities: [
      {
        name: "User",
        table: "User",
        fields: [
          { name: "id", type: "integer", required: true, unique: true },
          { name: "name", type: "string", required: false, unique: false },
        ],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    totalEntities: 1,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };
  const after = {
    entities: [
      {
        name: "User",
        table: "User",
        fields: [{ name: "id", type: "integer", required: true, unique: true }],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    totalEntities: 1,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };

  const diff = compareSchemas(before, after);
  assert.equal(diff.changed.length, 1);
  assert.ok(diff.changed[0].fieldChanges.some((fc) => fc.change === "removed"));
});

test("compareSchemas returns empty diff when schemas are identical", () => {
  const schema = {
    entities: [
      {
        name: "User",
        table: "User",
        fields: [{ name: "id", type: "integer", required: true, unique: true }],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    totalEntities: 1,
    totalRelations: 0,
    generatedAt: new Date().toISOString(),
  };

  const diff = compareSchemas(schema, schema);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 0);
});

test("formatSchemaDiff shows added entities", () => {
  const diff = {
    added: [
      {
        name: "User",
        table: "User",
        fields: [{ name: "id", type: "integer", required: true, unique: true }],
        relations: [],
        primaryKey: ["id"],
        indexes: [],
      },
    ],
    removed: [],
    changed: [],
  };

  const output = formatSchemaDiff(diff);
  assert.match(output, /Added Entities/);
  assert.match(output, /User/);
  assert.match(output, /1 fields/);
});

test("formatSchemaDiff shows removed entities", () => {
  const diff = {
    added: [],
    removed: [
      {
        name: "OldModel",
        table: "OldModel",
        fields: [],
        relations: [],
        primaryKey: [],
        indexes: [],
      },
    ],
    changed: [],
  };

  const output = formatSchemaDiff(diff);
  assert.match(output, /Removed Entities/);
  assert.match(output, /OldModel/);
});

test("formatSchemaDiff shows changed entities with field diffs", () => {
  const diff = {
    added: [],
    removed: [],
    changed: [
      {
        entity: "User",
        fieldChanges: [
          {
            field: "name",
            change: "type changed",
            before: "string",
            after: "integer",
          },
        ],
      },
    ],
  };

  const output = formatSchemaDiff(diff);
  assert.match(output, /Changed Entities/);
  assert.match(output, /User/);
  assert.match(output, /name/);
  assert.match(output, /type changed/);
  assert.match(output, /string/);
  assert.match(output, /integer/);
});

test("formatSchemaDiff shows no changes when diff is empty", () => {
  const diff = { added: [], removed: [], changed: [] };
  const output = formatSchemaDiff(diff);
  assert.match(output, /No schema changes/);
});

test("parsePrismaSchema handles Boolean and Float scalar types", () => {
  const root = fixture({
    "schema.prisma": `model Config {
  id    Int     @id
  flag  Boolean
  score Float
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  const flagField = report.entities[0].fields.find((f) => f.name === "flag");
  assert.equal(flagField!.type, "boolean");
  const scoreField = report.entities[0].fields.find((f) => f.name === "score");
  assert.equal(scoreField!.type, "float");
});

test("parsePrismaSchema ignores comments", () => {
  const root = fixture({
    "schema.prisma": `// This is a comment
# This is also a comment
model User {
  id Int @id
}
`,
  });

  const report = parsePrismaSchema(join(root, "schema.prisma"));
  assert.equal(report.totalEntities, 1);
});
