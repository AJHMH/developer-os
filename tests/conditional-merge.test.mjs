import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFixture } from "./helpers/merge-fixture.mjs";

test("owner approval merges only the validated head and records main without claiming delivery completion", async (t) => {
  const f = await mergeFixture(t);
  const d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.phase, "merged");
  assert.equal(d.merge.attempts.at(-1).state, "merged");
  assert.equal(d.merge.attempts.at(-1).mergeCommit, "c".repeat(40));
  assert.deepEqual(
    f.merges.map((r) => r.head),
    ["a".repeat(40)],
  );
  assert.equal(f.merges[0].baseRevision, d.publication.sourceRevision);
  assert.match(d.blocker.nextAction, /main.*checks/i);
  f.controller = f.reopenMerge();
  assert.equal(
    (await f.controller.mergeFeature(f.delivery.id)).phase,
    "merged",
  );
  assert.equal(f.merges.length, 1);
});

test("merge rechecks approvals, conversations and trusted checks instead of using cached readiness", async (t) => {
  const f = await mergeFixture(t);
  await f.controller.monitorReview(f.delivery.id);
  const review = f.reviewSnapshot,
    checks = f.snapshot;
  for (const mutate of [
    (s) => {
      s.reviews[0].state = "DISMISSED";
    },
    (s) => {
      s.requiredChanges = true;
    },
    (s) => {
      s.threads = [{ id: "thread1", digest: "3".repeat(64), resolved: false }];
    },
    (s) => {
      s.owner.permission = "read";
    },
    (s) => {
      s.reviews[0].head = "d".repeat(40);
    },
  ]) {
    f.reviewSnapshot = () => {
      const s = review();
      mutate(s);
      return s;
    };
    const d = await f.controller.mergeFeature(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(d.merge.attempts.at(-1).state, "blocked");
    assert.equal(f.merges.length, 0);
  }
  f.reviewSnapshot = review;
  f.snapshot = () => {
    const s = checks();
    s.checks[0].status = "failure";
    return s;
  };
  assert.equal(
    (await f.controller.mergeFeature(f.delivery.id)).phase,
    "blocked",
  );
  assert.equal(f.merges.length, 0);
});

test("head/base races, unsupported conditions and protection revocation never dispatch a merge", async (t) => {
  const f = await mergeFixture(t),
    observe = f.mergeSnapshot;
  for (const mutate of [
    (s) => {
      s.head = "d".repeat(40);
    },
    (s) => {
      s.baseRevision = "e".repeat(40);
    },
    (s) => {
      s.protectionsEnforced = false;
    },
    (s) => {
      s.conditionalHead = false;
    },
    (s) => {
      s.conditionalBase = false;
    },
    (s) => {
      s.gatesEnforced = false;
    },
    (s) => {
      s.mergeAllowed = false;
    },
    (s) => {
      s.actor = "factory[bot]";
    },
    (s) => {
      s.policySha256 = "0".repeat(64);
    },
  ]) {
    f.mergeSnapshot = () => {
      const s = observe();
      mutate(s);
      return s;
    };
    const d = await f.controller.mergeFeature(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.merges.length, 0);
  }
});

test("policy revocation and cancellation between observation and dispatch fence the merge", async (t) => {
  const f = await mergeFixture(t),
    observe = f.mergeRuntime.observe;
  f.mergeRuntime.observe = async (r) => {
    const s = await observe(r);
    await f.controller.cancel(f.delivery.id);
    return s;
  };
  const d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.phase, "cancelled");
  assert.equal(f.merges.length, 0);
  await assert.rejects(f.controller.mergeFeature(f.delivery.id));
});

test("native CLI refuses merge and reconciliation without qualified adapters", async (t) => {
  const f = await mergeFixture(t);
  const { spawnSync } = await import("node:child_process");
  for (const command of [
    "merge-feature",
    "reconcile-merge",
    "refresh-merge-base",
  ]) {
    const r = spawnSync(
      process.execPath,
      ["dist/cli.js", command, "--id", f.delivery.id, "--state-dir", f.state],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Merge|merge|Refresh/);
  }
  assert.equal(f.merges.length, 0);
});

test("remote changes after observation cannot pass conditional effect acceptance", async (t) => {
  const f = await mergeFixture(t),
    remote = f.mergeSnapshot,
    review = f.reviewSnapshot,
    checks = f.snapshot;
  for (const change of [
    () => {
      f.mergeSnapshot = () => ({ ...remote(), head: "e".repeat(40) });
    },
    () => {
      f.mergeSnapshot = () => ({ ...remote(), baseRevision: "e".repeat(40) });
    },
    () => {
      f.mergeSnapshot = () => ({ ...remote(), protectionsEnforced: false });
    },
    () => {
      f.reviewSnapshot = () => {
        const s = review();
        s.reviews[0].state = "DISMISSED";
        return s;
      };
    },
    () => {
      f.snapshot = () => {
        const s = checks();
        s.checks[0].status = "failure";
        return s;
      };
    },
  ]) {
    f.mergeSnapshot = remote;
    f.reviewSnapshot = review;
    f.snapshot = checks;
    f.beforeMerge = change;
    const d = await f.controller.mergeFeature(f.delivery.id);
    assert.equal(d.merge.attempts.at(-1).state, "not-applied");
    assert.equal(d.phase, "blocked");
    assert.equal(f.merges.length, 0);
  }
});

test("revoked onboarding authority after the remote observation prevents dispatch", async (t) => {
  const f = await mergeFixture(t),
    inspect = f.options.inspect,
    observe = f.mergeRuntime.observe;
  f.mergeRuntime.observe = async (r) => {
    const s = await observe(r);
    f.options.inspect = () => ({ ...inspect(), publicationAccess: false });
    return s;
  };
  const d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.merges.length, 0);
});
