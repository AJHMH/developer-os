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
