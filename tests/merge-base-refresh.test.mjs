import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mergeFixture } from "./helpers/merge-fixture.mjs";

async function advanced(t) {
  const f = await mergeFixture(t),
    observe = f.mergeSnapshot;
  // Observe remote main first; separately materialize verified clean main locally.
  writeFileSync(join(f.repository, "index.html"), "<h1>Updated main</h1>\n");
  f.git("add", ".");
  f.git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "main advances",
  );
  const next = f.git("rev-parse", "HEAD");
  // Exercise Windows-style Git defaults on every host.
  f.git("config", "core.autocrlf", "true");
  // Restore local main so the remote change is detected at the merge boundary.
  // Keep checkout bytes identical to the LF bytes admitted by the fixture.
  f.git("-c", "core.autocrlf=false", "checkout", "-B", "main", "HEAD^");
  f.mergeSnapshot = () => ({ ...observe(), baseRevision: next });
  let d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.merge.attempts.at(-1).advancedBase, next);
  assert.equal(f.merges.length, 0);
  return { f, next };
}

test("advanced main is revalidated and integrated through bounded repair before signed publication and renewed approval", async (t) => {
  const { f, next } = await advanced(t);
  f.git("-c", "core.autocrlf=false", "merge", "--ff-only", next);
  let d;
  const collect = f.runtime.collect;
  f.runtime.collect = async (r) => {
    const s = await collect(r);
    s.files[0].bytes = Buffer.from("<h1>Updated main</h1><p>Say hello</p>\n");
    s.files[0].beforeSha256 = s.files[0].afterSha256 = createHash("sha256")
      .update(s.files[0].bytes)
      .digest("hex");
    return s;
  };
  d = await f.controller.refreshMergeBase(f.delivery.id);
  assert.equal(d.repair.attempts.length, 1);
  assert.equal(d.repair.attempts[0].outcome, "passed");
  assert.equal(d.feature.sourceRevision, next);
  assert.equal(d.publication, undefined);
  assert.equal(d.review.runs.at(-1).approval, undefined);
  assert.equal(f.runtime.request.baseRefresh.to.revision, next);
  assert.equal(
    f.runtime.request.baseRefresh.to.files[0].bytes.toString(),
    "<h1>Updated main</h1>\n",
  );
  assert.ok(
    d.validation.attempts.some(
      (v) =>
        v.stage === "baseline" &&
        v.sourceRevision === next &&
        v.outcome === "passed",
    ),
  );
  f.controller = f.reopenMerge();
  await f.controller.refreshMergeBase(f.delivery.id);
  assert.equal(f.controller.status(f.delivery.id).repair.attempts.length, 1);
  const sign = f.runtimePublication.sign;
  f.runtimePublication.sign = async (r) => ({
    ...(await sign(r)),
    commit: "b".repeat(40),
    parent: r.publication.previous.commit,
  });
  await f.controller.publishFeature(f.delivery.id);
  const reviews = f.reviewSnapshot;
  f.reviewSnapshot = () => {
    const s = reviews();
    s.reviews[0].head = "a".repeat(40);
    return s;
  };
  d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.merges.length, 0);
});

test("unsafe local main and exhausted refresh allowance preserve the candidate and never merge", async (t) => {
  const { f, next } = await advanced(t);
  await assert.rejects(
    f.controller.refreshMergeBase(f.delivery.id),
    /clean local main/,
  );
  assert.ok(f.controller.status(f.delivery.id).publication);
  f.git("-c", "core.autocrlf=false", "merge", "--ff-only", next);
  writeFileSync(join(f.repository, "local.txt"), "unfinished work");
  await assert.rejects(f.controller.refreshMergeBase(f.delivery.id));
  const { unlinkSync } = await import("node:fs");
  unlinkSync(join(f.repository, "local.txt"));
  const execute = f.validation.execute;
  f.validation.execute = async (r) => {
    const result = await execute(r);
    f.time += 3600001;
    r.mayDispatch();
    return result;
  };
  let d = await f.controller.refreshMergeBase(f.delivery.id);
  assert.equal(d.repair.attempts[0].outcome, "exhausted");
  assert.equal(d.repair.activeMs, 3600001);
  f.controller = f.reopenMerge();
  await assert.rejects(
    f.controller.refreshMergeBase(f.delivery.id),
    /remaining repair allowance/,
  );
  assert.equal(f.controller.status(f.delivery.id).repair.attempts.length, 1);
  assert.equal(f.merges.length, 0);
  assert.equal(d.publicationHistory.length, 1);
});

test("coding failure after a passed advanced baseline remains retryable within cumulative allowance", async (t) => {
  const { f, next } = await advanced(t);
  f.git("-c", "core.autocrlf=false", "merge", "--ff-only", next);
  const execute = f.runtime.execute;
  f.runtime.execute = async () => {
    throw Error("worker failed");
  };
  let d = await f.controller.refreshMergeBase(f.delivery.id);
  assert.equal(d.repair.attempts[0].outcome, "failed");
  assert.equal(d.validation.attempts.at(-1).stage, "baseline");
  f.controller = f.reopenMerge();
  f.runtime.execute = execute;
  d = await f.controller.refreshMergeBase(f.delivery.id);
  assert.equal(d.repair.attempts.length, 2);
  assert.equal(d.repair.attempts.at(-1).outcome, "passed");
  assert.equal(f.merges.length, 0);
});

test("pinned refresh preparation owns both admitted baseline manifests", async (t) => {
  const { f, next } = await advanced(t);
  f.git("-c", "core.autocrlf=false", "merge", "--ff-only", next);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const runtime = f.runtime;
  let inspected, preparedFrom, preparedTo;
  f.runtime = new PinnedCodingRuntime(runtime.pins, {
    mode: "controlled",
    async inspect(request) {
      inspected = request;
      return { ...runtime.pins };
    },
    async run(request, output) {
      await Promise.resolve();
      inspected.baseRefresh.from.files[0].bytes.fill(120);
      inspected.baseRefresh.to.files[0].bytes.fill(120);
      preparedFrom = request.baseRefresh.from.files[0].bytes.toString();
      preparedTo = request.baseRefresh.to.files[0].bytes.toString();
      assert.equal(request.mayDispatch(), true);
      const result = await runtime.execute(request);
      output(
        Buffer.from(result.events.map((e) => JSON.stringify(e)).join("\n")),
      );
      return { ...result, pins: { ...runtime.pins } };
    },
    stop: (request) => runtime.stop(request),
    collect: (request) => runtime.collect(request),
  });
  f.controller = f.reopenMerge();
  const result = await f.controller.refreshMergeBase(f.delivery.id);
  assert.equal(preparedFrom, "<h1>Contact</h1>\n");
  assert.equal(preparedTo, "<h1>Updated main</h1>\n");
  assert.equal(result.repair.attempts.at(-1).outcome, "passed");
});
