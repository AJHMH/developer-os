import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

const entries = (d) => d.cleanup.rounds.at(-1).entries;
test("cleanup inventories unrelated local/remote tips, retains exclusions and completes only the controlled delivery", async (t) => {
  const f = await cleanupFixture(t);
  f.local("unrelated-merged");
  f.remoteBranch("remote-merged");
  f.local("protected");
  f.protected.add("local:protected");
  f.local("factory-events");
  f.replays.add("local:factory-events");
  f.g("config", "extensions.worktreeConfig", "true");
  f.g("config", "--worktree", "fixture.safe", "true");
  f.local("active");
  f.g("worktree", "add", join(f.root, "active-worktree"), "active");
  f.local("unmerged", f.newCommit());
  const d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(d.cleanup.productionEnabled, false);
  assert.ok(
    f.deletions.some(
      (x) => x.name === "unrelated-merged" && x.location === "local",
    ),
  );
  assert.ok(
    f.deletions.some(
      (x) => x.name === "remote-merged" && x.location === "remote",
    ),
  );
  assert.equal(
    entries(d).some((e) => e.fact.name === "main"),
    false,
  );
  for (const name of ["protected", "factory-events", "active", "unmerged"])
    assert.equal(
      entries(d).find((e) => e.fact.name === name).state,
      "retained",
    );
  assert.equal(f.g("rev-parse", "main"), f.target);
  assert.equal(f.merges.length, 1);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
  f.controller = f.reopenCleanup();
  await f.controller.recover(f.delivery.id);
  assert.equal(f.controller.status(f.delivery.id).phase, "completed");
  const released = f.controller.release(f.delivery.id);
  assert.equal(released.ownership.held, false);
  assert.equal(released.phase, "completed");
});

test("local and remote tips are evaluated independently and newer local commits are preserved", async (t) => {
  const f = await cleanupFixture(t),
    tip = f.newCommit();
  f.local("split", tip);
  f.remoteBranch("split");
  const d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(f.g("rev-parse", "split"), tip);
  assert.equal(
    entries(d).find(
      (e) => e.fact.name === "split" && e.fact.location === "local",
    ).reason,
    "unmerged",
  );
  assert.equal(
    entries(d).find(
      (e) => e.fact.name === "split" && e.fact.location === "remote",
    ).state,
    "deleted",
  );
});

test("squash and rebase linkage qualifies only the exact current tip, preserving newer tips and ambiguous results", async (t) => {
  const f = await cleanupFixture(t),
    head = f.newCommit("squashed head");
  const proof = {
    repository: "AJHMH/profile-page",
    base: "main",
    head,
    mergeCommit: f.target,
    merged: true,
    reachable: true,
    complete: true,
  };
  f.local("squashed", head);
  f.linkages.set("local:squashed", proof);
  f.local("rebased", head);
  f.linkages.set("local:rebased", proof);
  f.local("newer", f.newCommit("later work"));
  f.linkages.set("local:newer", proof);
  let d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(
    entries(d).find((e) => e.fact.name === "squashed").state,
    "deleted",
  );
  assert.equal(
    entries(d).find((e) => e.fact.name === "rebased").state,
    "deleted",
  );
  assert.equal(
    entries(d).find((e) => e.fact.name === "newer").reason,
    "newer-tip",
  );
  f.local("ambiguous", head);
  f.linkages.set("local:ambiguous", { ...proof, complete: false });
  d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(
    entries(d).find((e) => e.fact.name === "ambiguous").reason,
    "ambiguous-merge-linkage",
  );
});

test("unknown integration and unsupported conditional authority block instead of deleting blindly", async (t) => {
  const f = await cleanupFixture(t);
  f.local("unknown");
  f.unknown.add("local:unknown");
  f.local("unsupported");
  f.unsupported.add("local:unsupported");
  const d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.deletions.length, 0);
  assert.equal(
    entries(d).find((e) => e.fact.name === "unknown").reason,
    "integration-unknown",
  );
  assert.equal(
    entries(d).find((e) => e.fact.name === "unsupported").reason,
    "conditional-delete-unavailable",
  );
});

test("CLI refuses native cleanup authority", async (t) => {
  const f = await cleanupFixture(t);
  const r = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "cleanup-branches",
      "--id",
      f.delivery.id,
      "--state-dir",
      f.state,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /native cleanup remains disabled/);
  assert.equal(f.deletions.length, 0);
});
