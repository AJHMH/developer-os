import "./helpers/owner-host-stand-in.mjs";
// A delivery whose stopped session ran under another route, as one recorded
// before ADR 0008 can. Every Claude Code turn of a delivery shares its budget
// route, so coding then starts a new lineage and records the old one as
// superseded; the owner may later clean it up, once. The name sorts after
// every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { failedTurn, firstThread } from "./helpers/coding-turns.mjs";
import { planAndValidate } from "./helpers/validation-fixture.mjs";

/** Edit the persisted delivery, as an older controller left it. */
function persisted(f, change) {
  const db = new DatabaseSync(join(f.state, "deliveries.sqlite"));
  try {
    const { document } = db
      .prepare("SELECT document FROM deliveries WHERE id = ?")
      .get(f.delivery.id);
    const delivery = JSON.parse(document);
    change(delivery);
    db.prepare("UPDATE deliveries SET document = ? WHERE id = ?").run(
      JSON.stringify(delivery),
      f.delivery.id,
    );
  } finally {
    db.close();
  }
}

async function supersededFixture(t) {
  const f = codingFixture(t);
  await planAndValidate(f);
  // A failed turn leaves a stopped, resumable session.
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = failedTurn;
  const failed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(failed.feature.outcome, "failed");
  const prior = failed.feature.session;
  assert.equal(prior.threadId, firstThread);
  const olderRoute = {
    deliveryId: f.delivery.id,
    decisionSha256: "f".repeat(64),
  };
  persisted(f, (delivery) => (delivery.feature.session.route = olderRoute));
  f.runtime.execute = execute;
  const coded = await f.controller.codeFeature(f.delivery.id);
  return { f, prior, olderRoute, coded };
}

test("coding under a changed route starts a new lineage and records the old one", async (t) => {
  const { f, prior, olderRoute, coded } = await supersededFixture(t);
  const session = coded.feature.session;
  // Never a resume across routes.
  assert.equal(session.intent, "start");
  assert.notEqual(session.operationId, prior.operationId);
  assert.equal(f.runtime.request.threadId, undefined);
  assert.deepEqual(coded.feature.supersededLineages, [
    {
      operationId: prior.operationId,
      threadId: firstThread,
      route: olderRoute,
      provider: "claude",
      at: coded.feature.supersededLineages[0].at,
      by: session.operationId,
      session: {
        operationId: prior.operationId,
        fence: prior.fence,
        state: "stopped",
        intent: prior.intent,
        threadId: firstThread,
      },
    },
  ]);
});

test("the owner cleans a superseded lineage up once, through the coding runtime", async (t) => {
  const { f, prior } = await supersededFixture(t);
  const cleaned = [];
  f.runtime.cleanupSuperseded = async (session) => {
    cleaned.push(session);
    return {
      operationId: session.operationId,
      fence: session.fence,
      cleaned: 2,
    };
  };
  const done = await f.controller.cleanupSupersededLineage(
    f.delivery.id,
    prior.operationId,
  );
  const [entry] = done.feature.supersededLineages;
  assert.equal(entry.cleaned, 2);
  assert.match(entry.cleanedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(cleaned, [entry.session]);
  for (const operationId of [prior.operationId, "not-a-lineage"])
    await assert.rejects(
      f.controller.cleanupSupersededLineage(f.delivery.id, operationId),
      /Clean up only a recorded superseded lineage, once/,
    );
  assert.equal(cleaned.length, 1);
});

test("an unverified lineage cleanup records nothing and can be retried", async (t) => {
  const { f, prior } = await supersededFixture(t);
  f.runtime.cleanupSuperseded = async (session) => ({
    operationId: session.operationId,
    fence: session.fence,
    cleaned: 0,
  });
  await assert.rejects(
    f.controller.cleanupSupersededLineage(f.delivery.id, prior.operationId),
    /unverified; nothing was recorded/,
  );
  assert.equal(
    f.controller.status(f.delivery.id).feature.supersededLineages[0].cleanedAt,
    undefined,
  );
});
