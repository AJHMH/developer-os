import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

for (const race of [
  "local-tip",
  "remote-tip",
  "protection",
  "worktree",
  "policy",
  "pause",
  "binding",
])
  test(`cleanup refuses ${race} changes at effect acceptance`, async (t) => {
    const f = await cleanupFixture(t),
      location = race === "remote-tip" ? "remote" : "local";
    if (location === "local") f.local("victim");
    else f.remoteBranch("victim");
    const newer = f.newCommit();
    f.beforeDelete = async (r) => {
      if (r.name !== "victim") return;
      if (race === "local-tip")
        f.g("update-ref", "refs/heads/victim", newer, r.expectedTip);
      if (race === "remote-tip") f.remoteBranch("victim", newer);
      if (race === "protection") f.protected.add(`${location}:victim`);
      if (race === "worktree") {
        f.g("config", "extensions.worktreeConfig", "true");
        f.g("config", "--worktree", "fixture.safe", "true");
        f.g("worktree", "add", join(f.root, "raced-worktree"), "victim");
      }
      if (race === "policy") writeFileSync(f.options.policyPath, "{}");
      if (race === "pause") await f.controller.pause(f.delivery.id);
      if (race === "binding") f.cleanupRuntime.bindingSha256 = "3".repeat(64);
    };
    let d;
    try {
      d = await f.controller.cleanupBranches(f.delivery.id);
    } catch {
      d = f.controller.status(f.delivery.id);
    }
    assert.notEqual(d.phase, "completed");
    assert.equal(
      f.deletions.some((x) => x.name === "victim"),
      false,
    );
    if (location === "local")
      assert.equal(
        f.g("rev-parse", "victim"),
        race === "local-tip" ? newer : f.old,
      );
    else
      assert.match(
        f.g("ls-remote", "--heads", "origin", "refs/heads/victim"),
        new RegExp(newer),
      );
  });

test("malformed, duplicate, incomplete and wrong-repository inventories never dispatch and never retain private transport text", async (t) => {
  const f = await cleanupFixture(t);
  f.local("eligible");
  for (const modify of [
    (o) => ({ ...o, complete: false }),
    (o) => ({ ...o, repository: "wrong/repo" }),
    (o) => ({ ...o, branches: [...o.branches, o.branches[0]] }),
    (o) => ({ ...o, branches: [{ ...o.branches[0], name: "invalid..ref" }] }),
    (o) => ({ ...o, quiescent: false }),
  ]) {
    f.inventoryChange = modify;
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
  }
  f.inventoryChange = () => {
    throw Error("private transport diagnostic");
  };
  const d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.doesNotMatch(JSON.stringify(d), /private transport diagnostic/);
});

test("new eligible branches discovered at final inventory block completion until an explicit new plan", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  let added = false;
  f.afterDelete = async () => {
    if (!added) {
      added = true;
      f.local("late-merged");
    }
  };
  let d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.g("rev-parse", "late-merged"), f.old);
  assert.equal(
    d.cleanup.rounds.at(-1).entries.find((e) => e.fact.name === "late-merged")
      .state,
    "eligible",
  );
  f.afterDelete = undefined;
  d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(d.cleanup.rounds.length, 2);
});

for (const location of ["local", "remote"])
  test(`actual ${location} conditional deletion rejects a tip race after inspection`, async (t) => {
    const f = await cleanupFixture(t),
      newer = f.newCommit();
    if (location === "local") f.local("cas-victim");
    else f.remoteBranch("cas-victim");
    const git = f.g;
    let raced = false;
    f.g = (...args) => {
      const deletion =
        location === "local"
          ? args[0] === "update-ref" &&
            args[1] === "-d" &&
            args[2] === "refs/heads/cas-victim"
          : args[0] === "push" && args.at(-1) === ":refs/heads/cas-victim";
      if (deletion && !raced) {
        raced = true;
        if (location === "local")
          git("update-ref", "refs/heads/cas-victim", newer, f.old);
        else git("push", "origin", `${newer}:refs/heads/cas-victim`);
      }
      return git(...args);
    };
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(raced, true);
    assert.equal(d.phase, "blocked");
    const e = d.cleanup.rounds
      .at(-1)
      .entries.find((e) => e.fact.name === "cas-victim");
    assert.equal(e.reason, "tip-changed");
    assert.equal(
      f.deletions.some((e) => e.name === "cas-victim"),
      false,
    );
    if (location === "local")
      assert.equal(git("rev-parse", "cas-victim"), newer);
    else
      assert.match(
        git("ls-remote", "--heads", "origin", "refs/heads/cas-victim"),
        new RegExp(newer),
      );
  });
