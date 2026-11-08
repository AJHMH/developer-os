import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFixture } from "./helpers/merge-fixture.mjs";
import { reviewed } from "./helpers/review-fixture.mjs";

const base = "e".repeat(40);
const small = {
  base,
  complete: true,
  baseIsAncestor: true,
  files: [
    { path: "src/page.ts", status: "modified", additions: 3, deletions: 1 },
  ],
};
// A head the change gate classifies, with no owner review at all.
function unreviewed(f, changes) {
  const original = f.reviewSnapshot;
  f.reviewSnapshot = () => ({ ...original(), reviews: [], changes });
}

test("an ungated head is ready to merge without owner review, and records why", async (t) => {
  const f = await reviewed(t);
  unreviewed(f, small);
  const d = await f.controller.monitorReview(f.delivery.id);
  const run = d.review.runs.at(-1);
  assert.equal(d.phase, "ready-to-merge");
  assert.equal(run.outcome, "approved");
  assert.equal(run.approval.kind, "ungated");
  assert.equal(run.approval.head, d.publication.commit);
  assert.equal(run.approval.contractSha256, run.gate.contractSha256);
  assert.equal(run.gate.gated, false);
  assert.match(d.blocker.nextAction, /ungated/);
  assert.equal(
    f.reopenReview().status(d.id).review.runs.at(-1).approval.kind,
    "ungated",
  );
});

test("a gated head waits for exact-head owner approval and says why", async (t) => {
  const f = await reviewed(t);
  const gated = {
    ...small,
    files: [
      ...small.files,
      { path: "src/old.ts", status: "removed", additions: 0, deletions: 9 },
    ],
  };
  unreviewed(f, gated);
  let d = await f.controller.monitorReview(f.delivery.id);
  let run = d.review.runs.at(-1);
  assert.equal(run.outcome, "waiting");
  assert.equal(run.approval, undefined);
  assert.deepEqual(run.gate.destructive, ["deletes src/old.ts"]);
  assert.match(d.blocker.nextAction, /Gated change \(deletes src\/old.ts\)/);
  // The owner's exact-head approval authorizes the gated head.
  const withoutReview = f.reviewSnapshot;
  f.reviewSnapshot = () => {
    const s = withoutReview();
    return {
      ...s,
      reviews: [
        {
          id: 7,
          author: s.owner.login,
          type: "User",
          head: s.head,
          state: "APPROVED",
          submittedAt: 100000,
        },
      ],
    };
  };
  d = await f.controller.monitorReview(f.delivery.id);
  run = d.review.runs.at(-1);
  assert.equal(run.outcome, "approved");
  assert.equal(run.approval.reviewId, 7);
  assert.equal(run.gate.gated, true);
});

test("an ungated head is still blocked by requested changes, open threads or the owner's change request", async (t) => {
  for (const change of [
    (s) => (s.requiredChanges = true),
    (s) =>
      s.threads.push({ id: "t1", digest: "d".repeat(64), resolved: false }),
    (s) =>
      s.reviews.push({
        id: 3,
        author: s.owner.login,
        type: "User",
        head: s.head,
        state: "CHANGES_REQUESTED",
        submittedAt: 100000,
      }),
  ]) {
    const f = await reviewed(t);
    unreviewed(f, small);
    const ungated = f.reviewSnapshot;
    f.reviewSnapshot = () => {
      const s = ungated();
      change(s);
      return s;
    };
    const run = (
      await f.controller.monitorReview(f.delivery.id)
    ).review.runs.at(-1);
    assert.equal(run.approval, undefined);
    assert.notEqual(run.outcome, "approved");
  }
});

test("a missing diff keeps the owner gate and a malformed one is unavailable, never ungated", async (t) => {
  const f = await reviewed(t);
  unreviewed(f, undefined);
  let run = (await f.controller.monitorReview(f.delivery.id)).review.runs.at(
    -1,
  );
  assert.equal(run.outcome, "waiting");
  assert.equal(run.gate, undefined);
  unreviewed(f, {
    ...small,
    files: [
      { path: "../escape", status: "modified", additions: 1, deletions: 0 },
    ],
  });
  run = (await f.controller.monitorReview(f.delivery.id)).review.runs.at(-1);
  assert.equal(run.outcome, "unavailable");
  assert.equal(run.approval, undefined);
  assert.equal(run.gate, undefined);
});

test("an ungated head merges without any owner review when the repository relies on the change gate", async (t) => {
  const f = await mergeFixture(t);
  f.remoteRequiresReview = false;
  unreviewed(f, small);
  const d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.phase, "merged");
  assert.equal(f.merges.length, 1);
  assert.equal(f.merges[0].head, d.publication.commit);
});

test("a gated head with no owner review never dispatches a merge", async (t) => {
  const f = await mergeFixture(t);
  f.remoteRequiresReview = false;
  unreviewed(f, { ...small, baseIsAncestor: false });
  const d = await f.controller
    .mergeFeature(f.delivery.id)
    .catch(() => f.controller.status(f.delivery.id));
  assert.notEqual(d.phase, "merged");
  assert.equal(d.review.runs.at(-1).gate.gated, true);
  assert.equal(f.merges.length, 0);
});
