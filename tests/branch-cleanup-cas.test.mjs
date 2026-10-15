import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

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
