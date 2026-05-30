import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { enforceSafePath, getDirectoryTree, readFileContent } from "../src/fs-tools.js";

const TEST_DIR = path.join(process.cwd(), "test-fs-sandbox");

describe("fs-tools module", () => {
  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, "file1.txt"), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    fs.mkdirSync(path.join(TEST_DIR, "folderA"));
    fs.writeFileSync(path.join(TEST_DIR, "folderA", "fileA.txt"), "A");
    fs.mkdirSync(path.join(TEST_DIR, "folderA", "folderB"));
    fs.writeFileSync(path.join(TEST_DIR, "folderA", "folderB", "fileB.txt"), "B");
    fs.mkdirSync(path.join(TEST_DIR, ".git"));
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("enforceSafePath prevents directory traversal attacks", () => {
    assert.throws(() => {
      enforceSafePath(TEST_DIR, "../../../etc/passwd");
    }, /attempts to escape the root directory/);

    const safe = enforceSafePath(TEST_DIR, "folderA/fileA.txt");
    assert.equal(safe, path.join(TEST_DIR, "folderA/fileA.txt"));
  });

  test("getDirectoryTree accurately visualizes hierarchy and ignores dot git", () => {
    const tree = getDirectoryTree(TEST_DIR) as any;

    // .git should be excluded
    assert.equal(tree[".git/"], undefined);

    // Check files and folders
    assert.equal(tree["file1.txt"], "file");
    assert.ok(tree["folderA/"]);
    assert.equal(tree["folderA/"]["fileA.txt"], "file");
    assert.ok(tree["folderA/"]["folderB/"]);
    assert.equal(tree["folderA/"]["folderB/"]["fileB.txt"], "file");
  });

  test("getDirectoryTree stops at maxDepth", () => {
    const tree = getDirectoryTree(TEST_DIR, ".", { maxDepth: 1 }) as any;
    assert.equal(tree["file1.txt"], "file");
    // Inner level should be string indicating cutoff
    assert.equal(tree["folderA/"], "[MAX DEPTH REACHED]");
  });

  test("readFileContent slices files perfectly", () => {
    const full = readFileContent(TEST_DIR, "file1.txt");
    assert.equal(full.trim(), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

    const partial = readFileContent(TEST_DIR, "file1.txt", 2, 4);
    assert.equal(partial, "Line 2\nLine 3\nLine 4");

    const singleLine = readFileContent(TEST_DIR, "file1.txt", 3, 3);
    assert.equal(singleLine, "Line 3");
  });
});
