import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncFixture } from "./helpers/main-sync-fixture.mjs";

test("failed, incomplete, untrusted and advanced-main checks cannot authorize synchronization", async (t) => {
  const f = await syncFixture(t),
    original = f.mainSnapshot;
  for (const modify of [
    (o) => (o.checks[0].status = "failure"),
    (o) => (o.complete = false),
    (o) => (o.checks[0].publisher = "spoofed"),
    (o) => (o.mainRevision = "e".repeat(40)),
  ]) {
    f.time += 5000;
    f.mainSnapshot = () => {
      const o = original();
      modify(o);
      return o;
    };
    await assert.rejects(() => f.controller.syncMain(f.delivery.id));
    assert.equal(f.writes.length, 0);
    assert.equal(f.g("rev-parse", "main"), f.old);
  }
});

test("post-effect remote drift cannot report alignment and never rewrites the synchronized local revision", async (t) => {
  const f = await syncFixture(t);
  let next;
  f.afterWrite = async () => {
    next = f.g(
      "commit-tree",
      f.g("rev-parse", "main^{tree}"),
      "-p",
      f.target,
      "-m",
      "new remote",
    );
    f.g("push", "origin", `${next}:refs/heads/main`);
  };
  const d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(d.mainChecks.outcome, "unavailable");
  assert.equal(f.g("rev-parse", "main"), f.target);
  assert.equal(f.writes.length, 1);
});

test("unavailable final observation retains an uncertain attempt until read-only reconciliation", async (t) => {
  const f = await syncFixture(t);
  const observe = f.syncRuntime.observe;
  f.afterWrite = async () => {
    f.syncRuntime.observe = async () => {
      throw Error("private transport details");
    };
  };
  let d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.mainSync.attempts[0].state, "uncertain");
  assert.doesNotMatch(JSON.stringify(d), /private transport/);
  f.controller = f.reopen();
  f.syncRuntime.observe = observe;
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "main-synchronized");
  assert.equal(f.writes.length, 1);
});

test("cancellation fences a delayed effect and read-only recovery preserves cancellation", async (t) => {
  const f = await syncFixture(t);
  let request;
  f.syncRuntime.synchronize = async (r) => {
    request = r;
    f.inflight = true;
    return new Promise(() => {});
  };
  await f.controller.syncMain(f.delivery.id);
  await f.controller.cancel(f.delivery.id);
  assert.equal(request.mayDispatch(), false);
  f.inflight = false;
  const d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "cancelled");
  assert.equal(d.mainSync.attempts[0].state, "blocked");
  assert.equal(f.writes.length, 0);
});

test("changed observation binding before intent refuses the dispatch", async (t) => {
  const f = await syncFixture(t);
  f.beforeObserve = async (request) => {
    if (!request.operationId) f.syncRuntime.bindingSha256 = "4".repeat(64);
  };
  const d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.writes.length, 0);
  assert.equal(d.mainSync, undefined);
});
