import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

test("inventory cannot omit either main tip or report a different local main as complete", async (t) => {
  const f = await cleanupFixture(t);
  f.local("eligible");
  for (const modify of [
    (o) => ({
      ...o,
      branches: o.branches.filter(
        (b) => !(b.name === "main" && b.location === "local"),
      ),
    }),
    (o) => ({
      ...o,
      branches: o.branches.filter(
        (b) => !(b.name === "main" && b.location === "remote"),
      ),
    }),
    (o) => ({
      ...o,
      branches: o.branches.map((b) =>
        b.name === "main" && b.location === "local" ? { ...b, tip: f.old } : b,
      ),
    }),
  ]) {
    f.inventoryChange = modify;
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
  }
});

test("case-folded or Unicode-equivalent branch namespace collisions refuse the whole plan", async (t) => {
  const f = await cleanupFixture(t);
  f.local("eligible");
  for (const names of [["MAIN"], ["café", "cafe\u0301"]]) {
    f.inventoryChange = (o) => ({
      ...o,
      branches: [
        ...o.branches,
        ...names.map((name) => ({
          ...o.branches.find((b) => b.location === "local"),
          name,
        })),
      ],
    });
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
  }
});
