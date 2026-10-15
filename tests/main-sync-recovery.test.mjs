import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { syncFixture } from "./helpers/main-sync-fixture.mjs";

for (const race of ["dirty", "head", "remote", "policy", "binding", "pause"])
  test(`synchronization rechecks ${race} at the conditional effect boundary`, async (t) => {
    const f = await syncFixture(t);
    f.beforeWrite = async () => {
      if (race === "dirty")
        writeFileSync(join(f.repository, "index.html"), "preserved work\n");
      if (race === "head") f.g("switch", "-c", "other");
      if (race === "remote") {
        const n = f.g(
          "commit-tree",
          f.g("rev-parse", "main^{tree}"),
          "-p",
          f.target,
          "-m",
          "raced remote",
        );
        f.g("push", "origin", `${n}:refs/heads/main`);
      }
      if (race === "policy") writeFileSync(f.options.policyPath, "{}");
      if (race === "binding") f.syncRuntime.bindingSha256 = "4".repeat(64);
      if (race === "pause") await f.controller.pause(f.delivery.id);
    };
    let d;
    try {
      d = await f.controller.syncMain(f.delivery.id);
    } catch {
      d = f.controller.status(f.delivery.id);
    }
    assert.notEqual(d.phase, "main-synchronized");
    assert.equal(f.writes.length, 0);
    assert.equal(f.g("rev-parse", "main"), f.old);
    if (race === "dirty")
      assert.equal(
        readFileSync(join(f.repository, "index.html"), "utf8"),
        "preserved work\n",
      );
  });

test("lost accepted result is reconciled from actual refs without another write", async (t) => {
  const f = await syncFixture(t);
  f.afterWrite = async () => {
    throw Error("lost response");
  };
  let d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "main-synchronized");
  f.controller = f.reopen();
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "main-synchronized");
  assert.equal(f.writes.length, 1);
});

test("uncertain in-flight effects block retry and ownership release, then recover without redispatch", async (t) => {
  const f = await syncFixture(t);
  let captured;
  f.syncRuntime.synchronize = async (r) => {
    captured = r;
    f.inflight = true;
    return new Promise(() => {});
  };
  let d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.mainSync.attempts[0].state, "uncertain");
  assert.equal(captured.mayDispatch(), false);
  assert.throws(() => f.controller.release(f.delivery.id), /Reconcile/);
  assert.throws(() => f.controller.resume(f.delivery.id), /Reconcile/);
  f.controller = f.reopen();
  await f.controller.syncMain(f.delivery.id);
  assert.equal(f.controller.status(f.delivery.id).mainSync.attempts.length, 1);
  f.inflight = false;
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.mainSync.attempts[0].state, "blocked");
  assert.equal(f.writes.length, 0);
});

test("late failed recovery cannot overwrite a newer observation for the same operation", async (t) => {
  const f = await syncFixture(t);
  await f.controller.syncMain(f.delivery.id);
  const original = f.syncRuntime.observe;
  let release, entered;
  const ready = new Promise((r) => (entered = r));
  f.syncRuntime.observe = async (r) => {
    entered();
    return new Promise((resolve) => (release = resolve));
  };
  const old = f.controller.reconcileMainSync(f.delivery.id);
  await ready;
  f.syncRuntime.observe = original;
  f.controller = f.reopen();
  await f.controller.recover(f.delivery.id);
  release(undefined);
  await old;
  assert.equal(f.controller.status(f.delivery.id).phase, "main-synchronized");
  assert.equal(f.writes.length, 1);
});

test("candidate hooks, filters and included configuration cannot execute during synchronization", async (t) => {
  const f = await syncFixture(t),
    marker = join(f.root, "should-not-run");
  const hooks = join(f.root, "hooks");
  mkdirSync(hooks);
  writeFileSync(
    join(hooks, "post-checkout"),
    `#!/bin/sh\ntouch '${marker}'\n`,
    { mode: 0o700 },
  );
  f.g("config", "core.hooksPath", hooks);
  let d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "main-synchronized");
  assert.equal(existsSync(marker), false);
  for (const key of ["filter.evil.clean", "include.path"]) {
    f.g(
      "config",
      key,
      key.startsWith("filter")
        ? `touch '${marker}'`
        : join(f.root, "untrusted-config"),
    );
    d = await f.controller.syncMain(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(existsSync(marker), false);
    f.g("config", "--unset", key);
  }
});
