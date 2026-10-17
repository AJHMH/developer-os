import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve, sep } from "node:path";
import { pathContains } from "../dist/path-containment.js";
test("containment is inclusive, absolute, and rejects siblings and traversal", () => {
  const root = resolve("fixture");
  assert.equal(pathContains(root, root), true);
  assert.equal(pathContains(root, root + sep + "child"), true);
  assert.equal(pathContains(root, root + "-sibling"), false);
  assert.equal(pathContains(root, root + sep + ".." + sep + "escape"), false);
  assert.equal(pathContains("relative", "relative/child"), false);
});
test("Windows containment follows drive, separator and case semantics", () => {
  assert.equal(pathContains("C:\\Repo", "c:\\repo\\child", "win32"), true);
  assert.equal(pathContains("C:\\Repo", "D:\\Repo\\child", "win32"), false);
  assert.equal(pathContains("C:\\Repo", "C:\\Repo2", "win32"), false);
  assert.equal(
    pathContains("C:\\Repo", "C:\\Repo\\..\\escape", "win32"),
    false,
  );
  assert.equal(pathContains("C:\\", "C:\\Repo", "win32"), true);
});
