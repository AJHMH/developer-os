import assert from "node:assert/strict";
import { test } from "node:test";
import { monitored } from "./helpers/pr-checks-fixture.mjs";

test("trusted failed checks use cumulative repair and republish conditionally to the same PR", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.snapshot = () => {
    const s = snapshot();
    s.checks[0].status = "failure";
    return s;
  };
  await f.controller.monitorPRChecks(f.delivery.id);
  const collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (r) => {
    const s = await collect(r);
    s.files[0].bytes = Buffer.from("<h1>Contact</h1><p>Repaired</p>\n");
    const { createHash } = await import("node:crypto");
    s.files[0].beforeSha256 = s.files[0].afterSha256 = createHash("sha256")
      .update(s.files[0].bytes)
      .digest("hex");
    return s;
  };
  const repaired = await f.controller.repairPRChecks(f.delivery.id);
  assert.equal(repaired.repair.attempts.length, 1);
  assert.equal(repaired.repair.attempts[0].outcome, "passed");
  assert.equal(repaired.publication, undefined);
  assert.equal(repaired.publicationHistory[0].commit, "a".repeat(40));
  const sign = f.runtimePublication.sign.bind(f.runtimePublication);
  f.runtimePublication.sign = async (r) => ({
    ...(await sign(r)),
    commit: "b".repeat(40),
    parent: r.publication.previous.commit,
  });
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "published");
  assert.equal(d.publication.previous.commit, "a".repeat(40));
  assert.equal(d.publication.pullRequest.number, 1);
  f.snapshot = snapshot;
  f.time += 5000;
  const checked = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(checked.prChecks.runs.length, 2);
  assert.equal(checked.prChecks.runs[1].head, "b".repeat(40));
  assert.equal(checked.repair.attempts.length, 1);
});

test("a paused observation retains its result without advancing or consuming repair allowance", async (t) => {
  const f = await monitored(t);
  f.checks.observe = async () => {
    await f.controller.pause(f.delivery.id);
    return f.snapshot();
  };
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(d.phase, "paused");
  assert.equal(d.prChecks.runs[0].outcome, "passed");
  assert.equal(d.repair, undefined);
  f.controller.resume(f.delivery.id);
  f.time += 5000;
  f.checks.observe = async () => f.snapshot();
  assert.equal(
    (await f.reopenChecks().monitorPRChecks(f.delivery.id)).phase,
    "waiting-review",
  );
});

test("real signed repair updates the existing branch and preserves the PR identity", async (t) => {
  let signed;
  const f = await monitored(t, undefined, async (f) => {
    const { signedFixture } = await import("./helpers/publication-fixture.mjs");
    signed = signedFixture(f);
    f.runtimePublication = signed.runtime;
  });
  const old = f.controller.status(f.delivery.id).publication.commit;
  const snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  const collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (r) => {
    const v = await collect(r);
    v.files[0].bytes = Buffer.from("<h1>Contact repaired again</h1>\n");
    const { createHash } = await import("node:crypto");
    v.files[0].beforeSha256 = v.files[0].afterSha256 = createHash("sha256")
      .update(v.files[0].bytes)
      .digest("hex");
    return v;
  };
  await f.controller.repairPRChecks(f.delivery.id);
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "published");
  assert.equal(d.publication.pullRequest.number, 1);
  assert.equal(
    signed.git(["show", "-s", "--format=%P", d.publication.commit]),
    old,
  );
  assert.equal(d.publication.localSignature.localVerified, true);
});
