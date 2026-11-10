import "./helpers/owner-host-stand-in.mjs";
// The controller's own refusals around a Claude Code coding turn: the only
// coding agent (ADR 0008), the conversation a turn may bind, the allowance
// deadline that stops a running turn, and the controls around it. The name
// sorts after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { claudeEvents, firstThread } from "./helpers/coding-turns.mjs";
import { planAndValidate } from "./helpers/validation-fixture.mjs";

const otherThread = "22222222-2222-4222-8222-222222222222";

/** Edit the persisted delivery, as a stopped controller left it. */
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

test("a coding runtime for any agent but Claude Code is refused before anything is recorded", async (t) => {
  const f = codingFixture(t);
  f.runtime.agent = { ...f.runtime.agent, provider: "codex" };
  await planAndValidate(f);
  const before = f.controller.status(f.delivery.id);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /stopped controlled coding runtime/,
  );
  assert.deepEqual(f.controller.status(f.delivery.id), before);
  assert.equal(f.runtime.request, undefined);
});

test("a delivery that began coding under Codex is refused before anything is recorded", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  persisted(f, (delivery) => {
    delivery.feature.branch = `codex/feature-${f.delivery.id}`;
  });
  const before = f.controller.status(f.delivery.id);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /began coding under Codex, which was removed; start a new delivery/,
  );
  assert.deepEqual(f.controller.status(f.delivery.id), before);
  assert.equal(f.runtime.request, undefined);
});

test("a turn binds only its own conversation, from a session-start event", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  const answers = [];
  f.runtime.execute = async (request) => {
    // Not a session start, then the turn's start, then another one.
    answers.push(request.onEvent({ type: "assistant" }));
    answers.push(request.onEvent(claudeEvents(firstThread, true)[0]));
    try {
      answers.push(request.onEvent(claudeEvents(otherThread, true)[0]));
    } catch (error) {
      answers.push(error.message);
    }
    return {
      operationId: request.operationId,
      fence: request.fence,
      exitCode: 0,
      events: claudeEvents(firstThread, true),
    };
  };
  const coded = await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(answers, [false, true, "Coding session identity changed."]);
  assert.equal(coded.feature.session.threadId, firstThread);
});

test("a resumed turn refuses a session start for another conversation", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  f.runtime.execute = async (request) => ({
    operationId: request.operationId,
    fence: request.fence,
    exitCode: 1,
    events: claudeEvents(firstThread, false),
  });
  await f.controller.codeFeature(f.delivery.id);
  let answer;
  f.runtime.execute = async (request) => {
    assert.equal(request.threadId, firstThread);
    answer = request.onEvent(claudeEvents(otherThread, true)[0]);
    return {
      operationId: request.operationId,
      fence: request.fence,
      exitCode: 0,
      events: claudeEvents(firstThread, true),
    };
  };
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(answer, false);
});

test("a turn still running at its allowance is stopped at the deadline and charged the whole allowance", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  // Earlier coding left 30 ms of the allowance.
  persisted(f, (delivery) => {
    delivery.feature.allowanceMs = 60_000;
    delivery.feature.activeMs = 59_970;
  });
  let stopped = 0;
  const stop = f.runtime.stop.bind(f.runtime);
  f.runtime.stop = (request) => {
    stopped++;
    return stop(request);
  };
  // The turn never ends by itself.
  f.runtime.execute = () => new Promise(() => {});
  const coded = await f.controller.codeFeature(f.delivery.id);
  assert.ok(stopped >= 1);
  assert.equal(coded.feature.session.state, "stopped");
  assert.equal(coded.feature.candidate, undefined);
  assert.ok(coded.feature.activeMs >= coded.feature.allowanceMs);
  assert.deepEqual(f.messagesTurns.at(-1).gateway.revoked, ["stopped"]);
});

test("a pin change during a turn revokes its model session for that reason", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (request) => {
    const result = await execute(request);
    f.runtime.pins = { ...f.runtime.pins, bindingSha256: "9".repeat(64) };
    return result;
  };
  const coded = await f.controller.codeFeature(f.delivery.id);
  assert.equal(coded.feature.candidate, undefined);
  assert.deepEqual(f.messagesTurns.at(-1).gateway.revoked, ["pin-changed"]);
});

test("a cancelled delivery can't be paused, and release needs held, stopped work", async (t) => {
  const f = codingFixture(t);
  // A second request for the same repository queues and holds nothing.
  const queued = f.controller.start({
    repository: f.repository,
    request: "Add another hint.",
  });
  assert.equal(queued.ownership.held, false);
  assert.deepEqual(
    f.controller.release(queued.id),
    f.controller.status(queued.id),
  );
  // A delivery still implementing keeps its repository.
  persisted(f, (delivery) => (delivery.phase = "implementing"));
  await assert.rejects(
    async () => f.controller.release(f.delivery.id),
    /Stop the delivery before releasing repository ownership/,
  );
  await f.controller.cancel(f.delivery.id);
  await assert.rejects(
    f.controller.pause(f.delivery.id),
    /A cancelled delivery cannot be paused/,
  );
});

test("the controller refuses an unusable state directory or observation timeout", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aios-controller-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const state of ["", "  ", join(root, "bad\u0001name")])
    assert.throws(
      () => new DeliveryController(state, {}),
      /Provide a valid state directory/,
    );
  assert.throws(
    () => new DeliveryController(join(root, "ghp_" + "a".repeat(24)), {}),
    /without embedded credentials/,
  );
  for (const observationTimeoutMs of [0, 60_001, 1.5])
    assert.throws(
      () =>
        new DeliveryController(
          join(root, "state"),
          {},
          {
            observationTimeoutMs,
          },
        ),
      /observation timeout between 1 and 60000/,
    );
});

// Resume and coding refuse while an earlier effect is unsettled, and settle a
// paused delivery back to safe state.
const unsettled = {
  publication: (d) => (d.publication = { effects: [{ state: "dispatched" }] }),
  "PR diagnostic rerun": (d) =>
    (d.prChecks = { runs: [{ diagnostic: { state: "uncertain" } }] }),
  "repair cycle": (d) => (d.repair = { attempts: [{ state: "running" }] }),
};
for (const [name, change] of Object.entries(unsettled))
  test(`resume refuses while a ${name} is unsettled`, async (t) => {
    const f = codingFixture(t);
    persisted(f, change);
    const before = f.controller.status(f.delivery.id);
    assert.throws(
      () => f.controller.resume(f.delivery.id),
      /Reconcile|Recover/,
    );
    assert.deepEqual(f.controller.status(f.delivery.id), before);
  });

test("a paused delivery with no prior phase resumes blocked, without its uncertain blocker", async (t) => {
  const f = codingFixture(t);
  persisted(f, (d) => {
    d.phase = "paused";
    delete d.priorPhase;
    d.blocker = { code: "UNCERTAIN_SESSION", message: "", nextAction: "" };
  });
  const resumed = f.controller.resume(f.delivery.id);
  assert.equal(resumed.phase, "blocked");
  assert.equal(resumed.blocker.code, "DELIVERY_NOT_ENABLED");
});

test("coding refuses once publication or repair has begun", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  persisted(f, (d) => (d.publication = { effects: [] }));
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /Preserve publication evidence before further coding/,
  );
  persisted(f, (d) => {
    delete d.publication;
    d.repair = { attempts: [] };
  });
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /Use the persisted repair allowance/,
  );
});

test("resume clears an uncertain blocker once every session is stopped", async (t) => {
  const f = codingFixture(t);
  persisted(f, (d) => {
    d.phase = "blocked";
    d.blocker = { code: "UNCERTAIN_SESSION", message: "", nextAction: "" };
  });
  const resumed = f.controller.resume(f.delivery.id);
  assert.equal(resumed.phase, "blocked");
  assert.equal(resumed.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.equal(resumed.controls.at(-1).action, "resume");
});

test("a coding runtime whose pins still name a Codex code-mode host is refused", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  f.runtime.pins = { ...f.runtime.pins, codeModeHostSha256: "b".repeat(64) };
  const before = f.controller.status(f.delivery.id);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /stopped controlled coding runtime/,
  );
  assert.deepEqual(f.controller.status(f.delivery.id), before);
});

test("start refuses a repository path that looks like a credential", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-start-path-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "ghp_" + "a".repeat(24));
  mkdirSync(repository);
  const controller = new DeliveryController(join(root, "state"), {});
  assert.throws(
    () => controller.start({ repository, request: "Add a hint." }),
    /without embedded credentials/,
  );
  assert.deepEqual(controller.list().deliveries, []);
});
