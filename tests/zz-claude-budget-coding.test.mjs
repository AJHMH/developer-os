import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { storeAnthropicKey } from "../dist/anthropic-key.js";
import { claudeAgent } from "../dist/coding-agent.js";
import { DeliveryController, budgetRouteSha256 } from "../dist/controller.js";
import { MessagesGateway } from "../dist/messages-gateway.js";
import {
  meteredMessagesSessions,
  messagesSession,
} from "../dist/messages-sessions.js";
import {
  dollarsToPicodollars,
  pinnedModelPrices,
} from "../dist/spend-budget.js";
import { messagesEvents } from "../scripts/routed-provider.mjs";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { planAndValidate } from "./helpers/validation-fixture.mjs";

// ADR 0008: a Claude Code coding turn is metered through a Messages gateway,
// and the delivery's spend budget is its only model authority. No
// subscription usage, usage approval or mediation decision is read.
const model = pinnedModelPrices.model;
const thread = "22222222-2222-4222-8222-222222222222";
const claudePins = {
  cliVersion: "2.1.311",
  cliSha256: "c".repeat(64),
  policySha256: "d".repeat(64),
  bindingSha256: "e".repeat(64),
};
const request = (maxTokens = 1024) =>
  JSON.stringify({
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: [{ role: "user", content: "Add a contact hint." }],
  });
async function drain(stream) {
  for await (const _ of stream);
}

/** A Claude Code turn that sends `requests` Messages requests through the
 * gateway, then ends with `exitCode`. A refused request fails the turn. */
function claudeTurn({ requests = 1, exitCode: exit = 0 } = {}) {
  return async (req, gateway) => {
    const id = req.threadId ?? thread;
    let exitCode = exit;
    // Claude Code's init event binds the thread before any model request.
    req.onEvent({ type: "system", subtype: "init", session_id: id });
    try {
      for (let n = 0; n < requests; n++)
        await drain(
          await gateway.respond(
            req.modelRoute.deliveryId,
            gateway.capability,
            request(),
          ),
        );
    } catch {
      exitCode = 1;
    }
    req.checkpoint();
    return {
      operationId: req.operationId,
      fence: req.fence,
      exitCode,
      events: [
        { type: "system", subtype: "init", session_id: id },
        exitCode === 0
          ? {
              type: "result",
              subtype: "success",
              is_error: false,
              session_id: id,
            }
          : {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              session_id: id,
            },
      ],
    };
  };
}

/** Real Messages gateways with a fake provider and key. */
function messagesSessions() {
  const turns = [];
  const factory = (turn, budget) => {
    turns.push(turn);
    // The grant's expiry is on the controller's clock; the gateway keeps
    // real time.
    return messagesSession(
      new MessagesGateway(
        { ...turn, expiresAt: Date.now() + 60_000, maxRequests: 8 },
        () => "synthetic-key",
        budget,
        async function* () {
          yield Buffer.from(
            messagesEvents(
              "msg_1",
              model,
              [{ type: "text", text: "Done." }],
              "end_turn",
            ),
          );
        },
      ),
    );
  };
  return { turns, factory };
}

/** The coding fixture on Claude Code: no usage reader is installed, so any
 * subscription read would fail the turn. */
async function claudeCoding(t, turn = claudeTurn(), coordination) {
  const f = codingFixture(t);
  await planAndValidate(f);
  const launches = [];
  f.runtime.agent = claudeAgent;
  f.runtime.pins = { ...claudePins };
  f.runtime.execute = async (req, gateway) => {
    launches.push({ req, gateway });
    f.now += 50;
    return turn(req, gateway);
  };
  const sessions = messagesSessions();
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    validationRuntime: f.validation,
    clock: () => f.now,
    ...(coordination ?? { messagesSessions: sessions.factory }),
  });
  return { f, launches, sessions, id: f.delivery.id };
}

test("a Claude Code turn is authorized by the spend budget alone", async (t) => {
  const { f, launches, sessions, id } = await claudeCoding(t);
  const coded = await f.controller.codeFeature(id);
  assert.equal(launches.length, 1);
  const session = coded.feature.session;
  assert.equal(session.provider, "claude");
  assert.deepEqual(session.route, {
    deliveryId: id,
    decisionSha256: budgetRouteSha256(id),
  });
  assert.equal(session.threadId, thread);
  assert.equal(session.state, "stopped");
  assert.ok(coded.feature.candidate, "a completed turn leaves a candidate");
  assert.equal(coded.spend.reserved, undefined);
  assert.ok(coded.spend.spent > 0, "the request was charged");
  // No subscription authority was read or bound.
  assert.equal(coded.usage, undefined);
  assert.equal(coded.feature.usageAccountId, undefined);
  assert.equal(coded.feature.usageInterruptions, undefined);
  // The guest's relay capability is the turn's own, never the gateway's.
  const { req, gateway } = launches[0];
  assert.notEqual(req.modelRoute.capability, gateway.capability);
  assert.equal(sessions.turns[0].sessionId, session.operationId);
  assert.equal(budgetRouteSha256(id), budgetRouteSha256(id));
  assert.notEqual(
    budgetRouteSha256(id),
    budgetRouteSha256(f.delivery.id + "x"),
  );
});

test("without the owner's Anthropic key, a Claude Code turn refuses before any session", async (t) => {
  const { f, launches, id } = await claudeCoding(t, claudeTurn(), {});
  await assert.rejects(
    f.controller.codeFeature(id),
    /stored Anthropic key; supply --auth-directory/,
  );
  assert.equal(launches.length, 0);
  assert.equal(f.controller.status(id).feature.session, undefined);
});

test("a refused request stops the turn as a budget interruption, resumed after an extension", async (t) => {
  const { f, launches, id } = await claudeCoding(
    t,
    claudeTurn({ requests: 2 }),
  );
  // Spend all but a cent of the budget, so the turn's request is refused.
  const budget = dollarsToPicodollars(10),
    reserve = budget - dollarsToPicodollars(0.01);
  assert.equal(
    f.controller.admitModelRequest(id, "drain", reserve).admitted,
    true,
  );
  f.controller.chargeModelReservation(id, "drain");
  const interrupted = await f.controller.codeFeature(id);
  assert.equal(launches.length, 1);
  const first = interrupted.feature.session;
  assert.equal(first.state, "stopped");
  assert.equal(first.threadId, thread);
  assert.equal(interrupted.feature.candidate, undefined);
  assert.ok(interrupted.spend.interruption);
  assert.match(interrupted.blocker.message, /^Budget interruption/);
  assert.match(interrupted.blocker.nextAction, /extend-budget/);
  // No usage interruption or restart approval is recorded.
  assert.equal(interrupted.feature.usageInterruptions, undefined);
  assert.ok(
    interrupted.evidence.some((e) => e.kind === "interrupted-turn"),
    "the stopped workspace is kept as evidence",
  );
  // Coding refuses until the owner extends the budget.
  await assert.rejects(f.controller.codeFeature(id), /extend-budget/);
  assert.equal(launches.length, 1);
  f.controller.extendBudget(id, 10);
  const resumed = await f.controller.codeFeature(id);
  assert.equal(launches.length, 2);
  assert.equal(launches[1].req.intent, "resume");
  assert.equal(launches[1].req.threadId, thread);
  assert.deepEqual(resumed.feature.session.route, first.route);
  assert.ok(resumed.feature.candidate);
});

test("a request left reserved by a stopped turn is charged before coding continues", async (t) => {
  const { f, launches, id } = await claudeCoding(
    t,
    claudeTurn({ exitCode: 1 }),
  );
  const failed = await f.controller.codeFeature(id);
  const operationId = failed.feature.session.operationId;
  // A controller lost mid-request leaves its reservation behind.
  assert.equal(
    f.controller.admitModelRequest(id, `${operationId}-9`, 1000).admitted,
    true,
  );
  const spent = f.controller.status(id).spend.spent;
  await f.controller.codeFeature(id);
  assert.equal(launches.length, 2);
  const after = f.controller.status(id).spend;
  assert.equal(after.reserved, undefined);
  assert.ok(after.spent >= spent + 1000);
});

test("a reservation from another operation is never charged by coding", async (t) => {
  const { f, launches, id } = await claudeCoding(
    t,
    claudeTurn({ exitCode: 1 }),
  );
  await f.controller.codeFeature(id);
  assert.equal(
    f.controller.admitModelRequest(id, "elsewhere-1", 1000).admitted,
    true,
  );
  // The outstanding request refuses the turn's own; nothing is charged.
  const coded = await f.controller.codeFeature(id);
  assert.equal(launches.length, 2);
  assert.deepEqual(coded.spend.reserved, {
    operationId: "elsewhere-1",
    amount: 1000,
  });
});

test("the owner's stored Anthropic key meters each turn through its own gateway", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "aios-metered-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => meteredMessagesSessions(directory));
  writeFileSync(
    join(directory, "registration.json"),
    JSON.stringify({
      schema: 1,
      hostId: "urn:uuid:01234567-89ab-cdef-0123-456789abcdef",
      agentName: "Developer OS",
    }),
    { mode: 0o600 },
  );
  assert.throws(() => meteredMessagesSessions(directory), /No Anthropic key/);
  const apiKey = "sk-ant-api03-" + randomBytes(24).toString("base64url");
  const entries = new Map();
  const vault = {
    write: (id, value) => entries.set(id, value),
    read: (id) => entries.get(id),
  };
  await storeAnthropicKey({
    directory,
    apiKey,
    vault: () => vault,
    fetch: async () => ({
      status: 200,
      headers: { get: () => "org-synthetic-1234" },
    }),
  });
  const keys = [];
  const factory = meteredMessagesSessions(directory, {
    vault,
    provider: async function* (key) {
      keys.push(key);
      yield Buffer.from(
        messagesEvents(
          "msg_1",
          model,
          [{ type: "text", text: "ok" }],
          "end_turn",
        ),
      );
    },
  });
  const settled = [];
  const budget = {
    admit: () => true,
    charge: (op) => settled.push(["charge", op]),
    chargeReservation: (op) => settled.push(["reservation", op]),
    release: (op) => settled.push(["release", op]),
  };
  const deliveryId = "33333333-3333-4333-8333-333333333333",
    sessionId = "44444444-4444-4444-8444-444444444444";
  const gateway = factory(
    { deliveryId, sessionId, expiresAt: Date.now() + 60_000 },
    budget,
  );
  await drain(await gateway.respond(deliveryId, gateway.capability, request()));
  assert.deepEqual(keys, [apiKey]);
  assert.deepEqual(settled, [["charge", `${sessionId}-1`]]);
  // Without a stand-in, the gateway's provider is Anthropic's own; nothing
  // is requested to open it, and expiry keeps its own reason.
  const real = meteredMessagesSessions(directory, { vault })(
    { deliveryId, sessionId, expiresAt: Date.now() + 60_000 },
    budget,
  );
  assert.match(real.capability, /^[a-f0-9]{64}$/);
  real.revoke("expired");
  await assert.rejects(
    real.respond(deliveryId, real.capability, request()),
    (error) => error.reason === "revoked",
  );
  // The relay's own reasons for ending a session all stop it.
  gateway.revoke("paused");
  await assert.rejects(
    gateway.respond(deliveryId, gateway.capability, request()),
    (error) => error.reason === "revoked",
  );
});
