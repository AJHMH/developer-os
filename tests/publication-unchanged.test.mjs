// A candidate identical to main is never published. The third real delivery
// (12 November) asked for a hint main already had: Claude Code rightly
// changed nothing, and the delivery still published and merged an empty
// commit.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fixture } from "./helpers/publication-controller-fixture.mjs";

/** The coding turn returns main's own `index.html`, unchanged. */
const unchanged = (f) => {
  const collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (request) => {
    const r = await collect(request);
    const bytes = Buffer.from("<h1>Contact</h1>\n"),
      hash = createHash("sha256").update(bytes).digest("hex");
    return {
      ...r,
      files: r.files.map((file) => ({
        ...file,
        bytes,
        beforeSha256: hash,
        afterSha256: hash,
      })),
    };
  };
};

test("a candidate with exactly main's files is refused before any signing, push or PR", async (t) => {
  const f = await fixture(t, undefined, unchanged);
  const before = f.controller.status(f.delivery.id);
  assert.equal(before.feature.candidate.validation, "passed");
  await assert.rejects(
    f.controller.publishFeature(f.delivery.id),
    /changes nothing: its files are exactly main's/,
  );
  assert.deepEqual(f.events, []);
  const d = f.controller.status(f.delivery.id);
  assert.equal(d.publication, undefined);
  assert.equal(d.phase, "blocked");
  assert.match(d.blocker.nextAction, /Nothing to publish/);
  // It stays refused: nothing about the candidate changed.
  await assert.rejects(
    f.controller.publishFeature(f.delivery.id),
    /changes nothing/,
  );
  assert.deepEqual(f.events, []);
});

test("a changed candidate still publishes", async (t) => {
  const f = await fixture(t);
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "published");
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});
