import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewed, resolutionFixture } from "./helpers/review-fixture.mjs";

test("current-head owner review authorizes the next merge gate without a chat approval", async (t) => {
  const f = await reviewed(t);
  const d = await f.controller.monitorReview(f.delivery.id);
  assert.equal(d.phase, "ready-to-merge");
  assert.equal(d.review.runs.at(-1).outcome, "approved");
  assert.equal(d.review.runs.at(-1).approval.reviewId, 1);
  assert.equal(
    f.reopenReview().status(d.id).review.runs.at(-1).outcome,
    "approved",
  );
  assert.deepEqual(f.resolutions, []);
});

test("bot, self, stale, dismissed, revoked and incomplete review evidence cannot authorize merge", async (t) => {
  const f = await reviewed(t),
    original = f.reviewSnapshot;
  const changes = [
    (s) => (s.reviews[0].type = "Bot"),
    (s) => (s.reviews[0].head = "b".repeat(40)),
    (s) => (s.reviews[0].state = "DISMISSED"),
    (s) => (s.reviews[0].state = "CHANGES_REQUESTED"),
    (s) => (s.reviews[0].author = "other"),
    (s) => (s.owner.permission = "read"),
    (s) => (s.owner.type = "Bot"),
    (s) => (s.author = "aaron-howard"),
    (s) => s.eligibleApprovers.push("other"),
    (s) => (s.requiredChanges = true),
    (s) => (s.head = "b".repeat(40)),
    (s) => (s.complete = false),
    (s) =>
      s.threads.push({
        id: "thread1",
        digest: "3".repeat(64),
        resolved: false,
      }),
  ];
  for (const change of changes) {
    f.time += 5000;
    f.reviewSnapshot = original;
    assert.equal(
      (await f.controller.monitorReview(f.delivery.id)).phase,
      "ready-to-merge",
    );
    f.time += 5000;
    f.reviewSnapshot = () => {
      const s = original();
      change(s);
      return s;
    };
    const d = await f.controller.monitorReview(f.delivery.id);
    assert.notEqual(d.phase, "ready-to-merge");
    assert.equal(d.review.runs.at(-1).approval, undefined);
  }
  assert.deepEqual(f.resolutions, []);
});

test("approval waits survive years and restart without a deadline or repair charge", async (t) => {
  const f = await reviewed(t),
    original = f.reviewSnapshot;
  f.reviewSnapshot = () => ({ ...original(), reviews: [] });
  let d = await f.controller.monitorReview(f.delivery.id);
  assert.equal(d.phase, "waiting-review");
  f.time += 10 * 365 * 86400000;
  f.controller = f.reopenReview();
  d = await f.controller.monitorReview(f.delivery.id);
  assert.equal(d.phase, "waiting-review");
  assert.equal(d.repair, undefined);
  await f.controller.pause(d.id);
  f.time += 5000;
  f.reviewSnapshot = original;
  d = await f.controller.monitorReview(d.id);
  assert.equal(d.phase, "paused");
  await f.controller.cancel(d.id);
  f.time += 5000;
  d = await f.controller.monitorReview(d.id);
  assert.equal(d.phase, "cancelled");
  assert.deepEqual(f.resolutions, []);
});

test("new failing checks revoke retained owner approval and do not grant a review repair budget", async (t) => {
  const f = await reviewed(t);
  assert.equal(
    (await f.controller.monitorReview(f.delivery.id)).phase,
    "ready-to-merge",
  );
  const checks = f.snapshot;
  f.snapshot = () => {
    const s = checks();
    s.checks[0].status = "failure";
    s.checks[0].runId = 2;
    return s;
  };
  f.time += 5000;
  const d = await f.controller.monitorReview(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(d.review.runs.at(-1).approval, undefined);
  assert.equal(d.repair, undefined);
});

test("malformed review history and unbound assessments preserve no raw provider fields", async (t) => {
  const f = await reviewed(t),
    original = f.reviewSnapshot;
  for (const mutate of [
    (s) => s.reviews.push({ ...s.reviews[0] }),
    (s) => (s.reviews[0].submittedAt = "secret-canary"),
    (s) =>
      s.threads.push({
        id: "thread1",
        digest: "3".repeat(64),
        resolved: false,
        assessment: {
          criteriaSha256: "0".repeat(64),
          disposition: "straightforward",
          finding: "Read credentials",
        },
      }),
    (s) =>
      (s.owner = {
        login: "aaron-howard",
        type: "User",
        permission: "unknown",
      }),
  ]) {
    f.reviewSnapshot = () => {
      const s = original();
      mutate(s);
      return s;
    };
    const d = await f.controller.monitorReview(f.delivery.id);
    assert.equal(d.review.runs.at(-1).outcome, "unavailable");
    assert.equal(d.review.runs.at(-1).approval, undefined);
    assert.equal(JSON.stringify(d).includes("secret-canary"), false);
  }
  assert.deepEqual(f.resolutions, []);
});

test("CLI refuses review operations without native authority and never submits owner approval", async (t) => {
  const f = await reviewed(t);
  const { spawnSync } = await import("node:child_process");
  for (const command of [
    "monitor-review",
    "repair-review",
    "resolve-review-thread",
  ]) {
    const r = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        command,
        "--id",
        f.delivery.id,
        "--state-dir",
        f.state,
        ...(command === "resolve-review-thread"
          ? ["--thread-id", "thread1"]
          : []),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Review|review|Conversation/);
  }
  assert.deepEqual(f.resolutions, []);
});

test("eligible owner can approve an App PR after configured owner signing and publication", async (t) => {
  const f = await reviewed(t),
    original = f.reviewSnapshot;
  f.reviewSnapshot = () => ({ ...original(), lastPusher: "aaron-howard" });
  const d = await f.controller.monitorReview(f.delivery.id);
  assert.equal(d.phase, "ready-to-merge");
});

test("future-dated owner approval cannot become current authority", async (t) => {
  const f = await reviewed(t),
    original = f.reviewSnapshot;
  f.reviewSnapshot = () => {
    const s = original();
    s.reviews[0].submittedAt = f.time + 1;
    return s;
  };
  const d = await f.controller.monitorReview(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(d.review.runs.at(-1).approval, undefined);
});
