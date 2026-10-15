import assert from "node:assert/strict";
import { test } from "node:test";
import { monitored } from "./helpers/pr-checks-fixture.mjs";

test("exact-head trusted PR checks advance only to independent review and survive restart", async (t) => {
  const f = await monitored(t);
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(d.phase, "waiting-review");
  assert.equal(d.prChecks.runs[0].outcome, "passed");
  assert.equal(d.prChecks.runs[0].attempts[0].head, d.publication.commit);
  assert.equal(
    f.reopenChecks().status(f.delivery.id).prChecks.runs[0].outcome,
    "passed",
  );
  assert.deepEqual(f.reruns, []);
});

for (const [name, patch] of [
  ["stale head", { head: "b".repeat(40) }],
  ["spoofed publisher", { publisher: "other" }],
  ["spoofed workflow", { workflow: "untrusted" }],
  ["skipped", { status: "skipped" }],
  ["neutral", { status: "neutral" }],
  ["cancelled", { status: "cancelled" }],
  ["pending", { status: "pending", completedAt: undefined }],
])
  test(`${name} cannot pass required PR checks`, async (t) => {
    const f = await monitored(t),
      snapshot = f.snapshot;
    f.snapshot = () => {
      const s = snapshot();
      Object.assign(s.checks[0], patch);
      return s;
    };
    const d = await f.controller.monitorPRChecks(f.delivery.id);
    assert.notEqual(d.prChecks.runs[0].outcome, "passed");
    assert.notEqual(d.phase, "waiting-review");
  });

test("missing checks poll at a bounded rate and retain the declared deadline across restart", async (t) => {
  const f = await monitored(t);
  const snapshot = f.snapshot;
  f.snapshot = () => ({ ...snapshot(), checks: [] });
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 1000;
  await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(f.reads, 1);
  f.time = 220000;
  const d = await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "timeout");
  assert.equal(f.reads, 1);
  assert.equal(d.phase, "blocked");
});

test("a passing retry preserves failure and blocks unexplained intermittency", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  const failure = { ...snapshot().checks[0], status: "failure" };
  f.snapshot = () => ({ ...snapshot(), checks: [failure] });
  await f.controller.monitorPRChecks(f.delivery.id);
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  assert.equal(f.reruns.length, 1);
  await assert.rejects(
    f.controller.rerunPRCheck(f.delivery.id, "pr-ci"),
    /rerun blocked/,
  );
  f.time += 5000;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      failure,
      {
        ...snapshot().checks[0],
        attempt: 2,
        startedAt: 105000,
        completedAt: 105000,
      },
    ],
  });
  const d = await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "flaky");
  assert.equal(d.prChecks.runs[0].attempts.length, 2);
});

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

test("owner exceptions and flake policy apply only to trusted evidence", async (t) => {
  const f = await monitored(t, (p) => {
      const c = p.validationContract.checks.find((c) => c.scope === "pr");
      c.exception = { statuses: ["skipped"], reason: "Owner exception" };
      c.flake = {
        allowDiagnosticPass: true,
        reason: "Owner-approved intermittent service",
      };
    }),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "skipped" }],
  });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "passed",
  );
  f.time += 5000;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      { ...snapshot().checks[0], status: "skipped" },
      {
        ...snapshot().checks[0],
        runId: 2,
        status: "failure",
        startedAt: 105000,
        completedAt: 105000,
      },
      {
        ...snapshot().checks[0],
        runId: 2,
        attempt: 2,
        startedAt: 105000,
        completedAt: 105000,
      },
    ],
  });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "passed",
  );
  f.time += 5000;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      { ...snapshot().checks[0], status: "skipped", publisher: "spoof" },
    ],
  });
  assert.notEqual(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "passed",
  );
});

test("unknown rerun acceptance survives restart and late dispatch remains fenced", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  let late;
  f.checks.rerun = async (r) => {
    late = r;
    throw Error("secret=never-store-this");
  };
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  assert.equal(late.mayDispatch(), false);
  assert.throws(() => f.controller.release(f.delivery.id), /Reconcile/);
  await assert.rejects(
    f.reopenChecks().rerunPRCheck(f.delivery.id, "pr-ci"),
    /blocked/,
  );
  await f.controller.cancel(f.delivery.id);
  f.time += 5000;
  const failed = f.snapshot;
  f.snapshot = () => ({
    ...failed(),
    reruns: [{ operationId: late.operationId, state: "accepted" }],
  });
  const d = await f.reopenChecks().recover(f.delivery.id);
  assert.equal(d.phase, "cancelled");
  assert.equal(d.prChecks.runs[0].diagnostic.state, "accepted");
  assert.equal(d.prChecks.runs[0].canRepair, false);
  assert.equal(JSON.stringify(d).includes("never-store-this"), false);
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

test("new remote head and incomplete history invalidate previously passing evidence", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 5000;
  f.snapshot = () => ({ ...snapshot(), head: "b".repeat(40) });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "stale",
  );
  await assert.rejects(f.controller.repairPRChecks(f.delivery.id), /PR repair/);
  f.time += 5000;
  f.snapshot = () => ({ ...snapshot(), complete: false });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "unavailable",
  );
});

test("default CI deadline, unavailable clock and observations all fail closed", async (t) => {
  const f = await monitored(t, (p) => {
    delete p.validationContract.checks.find((c) => c.scope === "pr").timeoutMs;
  });
  f.checks.observe = async () => {
    throw Error("private provider output");
  };
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].checks[0].timeoutMs, 3600000);
  assert.equal(d.prChecks.runs[0].outcome, "unavailable");
  f.time = NaN;
  assert.equal(
    (await f.reopenChecks().monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "timeout",
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

test("timed-out diagnostic recovery resolves acceptance without reopening checks or writes", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  let operation;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  f.checks.rerun = async (r) => {
    operation = r.operationId;
    throw Error("lost");
  };
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  f.time = 220000;
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "timeout",
  );
  const failed = f.snapshot;
  f.snapshot = () => ({
    ...failed(),
    reruns: [{ operationId: operation, state: "accepted" }],
  });
  f.time += 5000;
  const d = await f.reopenChecks().recover(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "timeout");
  assert.equal(d.prChecks.runs[0].diagnostic.state, "accepted");
  assert.equal(f.controller.release(f.delivery.id).ownership.held, false);
});

test("runtime drift fences diagnostic dispatch and observation admission", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  let allowed;
  f.checks.rerun = async (r) => {
    f.checks.bindingSha256 = "8".repeat(64);
    allowed = r.mayDispatch();
    return { operationId: r.operationId, accepted: false };
  };
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  assert.equal(allowed, false);
  f.checks.bindingSha256 = "9".repeat(64);
  f.time += 5000;
  f.snapshot = snapshot;
  f.checks.observe = async () => {
    f.checks.bindingSha256 = "8".repeat(64);
    return snapshot();
  };
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "unavailable");
});

test("malformed pending timestamp cannot persist untrusted response fields", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      {
        ...snapshot().checks[0],
        status: "pending",
        completedAt: { secret: "timestamp-canary" },
      },
    ],
  });
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(JSON.stringify(d).includes("timestamp-canary"), false);
  assert.notEqual(d.prChecks.runs[0].outcome, "passed");
});

test("declared long CI deadlines survive downtime beyond the default hour", async (t) => {
  const f = await monitored(t, (p) => {
      p.validationContract.checks.find((c) => c.scope === "pr").timeoutMs =
        7200000;
    }),
    snapshot = f.snapshot;
  f.snapshot = () => ({ ...snapshot(), checks: [] });
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 5400000;
  const d = await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "incomplete");
  assert.equal(d.prChecks.runs[0].startedAt, 100000);
  assert.equal(d.repair, undefined);
});

test("a stale concurrent observation cannot overwrite newer failure evidence", async (t) => {
  const f = await monitored(t),
    good = f.snapshot();
  const entered = Promise.withResolvers(),
    response = Promise.withResolvers();
  t.after(() => response.resolve(good));
  f.checks.observe = async () => {
    entered.resolve();
    return response.promise;
  };
  const first = f.controller.monitorPRChecks(f.delivery.id);
  await Promise.race([
    entered.promise,
    first.then(() => {
      throw Error("observation never entered");
    }),
  ]);
  f.time += 5000;
  f.checks.observe = async () => ({
    ...good,
    checks: [{ ...good.checks[0], status: "failure" }],
  });
  await f.reopenChecks().monitorPRChecks(f.delivery.id);
  response.resolve(good);
  await first;
  assert.equal(
    f.controller.status(f.delivery.id).prChecks.runs[0].outcome,
    "failed",
  );
});

test("terminal checks completing after the declared deadline cannot pass", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.checks.observe = async () => {
    f.time = 220001;
    const s = snapshot();
    s.checks[0].completedAt = f.time;
    return s;
  };
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "timeout",
  );
});

test("CLI refuses hosted monitoring without a trusted adapter and missing workflow declarations block", async (t) => {
  const f = await monitored(t, (p) => {
    delete p.validationContract.checks.find((c) => c.scope === "pr").workflow;
  });
  await assert.rejects(
    f.controller.monitorPRChecks(f.delivery.id),
    /monitoring requires/,
  );
  assert.equal(f.reads, 0);
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "monitor-pr-checks",
      "--id",
      f.delivery.id,
      "--state-dir",
      f.state,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /native monitoring remains disabled/);
});

test("reopening during timeout reconciliation cannot erase the durable timeout verdict", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  let operation;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  f.checks.rerun = async (r) => {
    operation = r.operationId;
    throw Error("lost");
  };
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  f.time = 220000;
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 5000;
  const entered = Promise.withResolvers(),
    response = Promise.withResolvers();
  const answer = {
    ...f.snapshot(),
    reruns: [{ operationId: operation, state: "accepted" }],
  };
  t.after(() => response.resolve(answer));
  f.checks.observe = async () => {
    entered.resolve();
    return response.promise;
  };
  const first = f.controller.monitorPRChecks(f.delivery.id);
  await Promise.race([
    entered.promise,
    first.then(() => {
      throw Error("no reconciliation");
    }),
  ]);
  const persisted = f.reopenChecks().status(f.delivery.id).prChecks
    .runs[0].outcome;
  f.time += 5000;
  f.checks.observe = async () => answer;
  await f.reopenChecks().monitorPRChecks(f.delivery.id);
  response.resolve(answer);
  await first;
  assert.equal(persisted, "timeout");
  assert.equal(
    f.controller.status(f.delivery.id).prChecks.runs[0].outcome,
    "timeout",
  );
});
