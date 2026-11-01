import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  approvedGeneralSessions,
  approvedRoutedTurns,
  prepareRoutedTurns,
  routedTurnPlanMs,
} from "../dist/routed-turn-approval.js";

const pins = {
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
  codeModeHostSha256: "2".repeat(64),
  policySha256: "3".repeat(64),
  bindingSha256: "4".repeat(64),
};
const deliveryId = "11111111-2222-4333-8444-555555555555";
const accountId = "a".repeat(64);
const machine = "aios-test";
const now = Date.parse("2026-11-01T12:00:00Z");

function state(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-routed-approval-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const prepare = (directory, turns = 2) =>
  prepareRoutedTurns(
    directory,
    { deliveryId, accountId, machine, pins, turns },
    now,
  );
const approve = (directory, plan, overrides = {}, at = now) =>
  approvedRoutedTurns(
    directory,
    {
      deliveryId,
      accountId,
      machine,
      pins,
      runId: plan.runId,
      turns: plan.turns,
      ...overrides,
    },
    () => at,
  );

test("the owner's plan names one delivery, account, VM, coding pins and turn count, and expires", (t) => {
  const directory = state(t);
  const plan = prepare(directory, 1);
  assert.match(plan.runId, /^[a-f0-9-]{36}$/);
  assert.equal(plan.turns, 1);
  assert.equal(plan.expiresAt, now + routedTurnPlanMs);
  const [file] = readdirSync(directory);
  assert.equal(file, `routed-turns-${plan.runId}.plan.json`);
  assert.equal(
    JSON.parse(readFileSync(join(directory, file))).deliveryId,
    deliveryId,
  );
  if (process.platform !== "win32")
    assert.equal(statSync(join(directory, file)).mode & 0o777, 0o600);
  // At most two live turns per run (ADR 0002).
  for (const turns of [0, 3, 1.5])
    assert.throws(() => prepare(directory, turns), /1 or 2 turns/);
});

test("an approval spends exactly the turns it names, once each, and never more", (t) => {
  const directory = state(t);
  const plan = prepare(directory);
  const approval = approve(directory, plan);
  approval.spend(deliveryId);
  approval.spend(deliveryId);
  assert.throws(() => approval.spend(deliveryId), /approved turns are spent/);
  // A second process naming the same run finds the turns already spent.
  assert.throws(
    () => approve(directory, plan).spend(deliveryId),
    /approved turns are spent/,
  );
  for (const turn of [1, 2])
    assert.ok(
      existsSync(
        join(directory, `routed-turns-${plan.runId}-${turn}.consumed`),
      ),
    );
});

test("an approval that does not match its current plan is refused before any turn", (t) => {
  const directory = state(t);
  const plan = prepare(directory);
  for (const overrides of [
    { runId: "not-a-run" },
    { runId: "99999999-2222-4333-8444-555555555555" },
    { turns: 1 },
    { deliveryId: "99999999-2222-4333-8444-555555555555" },
    { accountId: "b".repeat(64) },
    { machine: "aios-other" },
    { pins: { ...pins, policySha256: "5".repeat(64) } },
  ])
    assert.throws(
      () => approve(directory, plan, overrides),
      /does not match a current plan/,
      JSON.stringify(overrides),
    );
  assert.throws(
    () => approve(directory, plan, {}, now + routedTurnPlanMs),
    /does not match a current plan/,
  );
  // A plan that expires between approval and the turn spends nothing.
  let clock = now;
  const approval = approvedRoutedTurns(
    directory,
    { deliveryId, accountId, machine, pins, runId: plan.runId, turns: 2 },
    () => clock,
  );
  clock = now + routedTurnPlanMs;
  assert.throws(() => approval.spend(deliveryId), /expired/);
  assert.throws(
    () =>
      approve(directory, plan).spend("99999999-2222-4333-8444-555555555555"),
    /another delivery/,
  );
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.endsWith(".consumed")),
    [],
  );
});

test("routed sessions open only after a turn is spent", (t) => {
  const directory = state(t);
  const plan = prepare(directory, 1);
  const opened = [];
  const sessions = approvedGeneralSessions(
    (turn) => (opened.push(turn.sessionId), { gateway: turn.sessionId }),
    approve(directory, plan),
  );
  const turn = (sessionId) => ({ deliveryId, sessionId, accountId });
  assert.deepEqual(
    sessions(turn("first"), async () => ({})),
    {
      gateway: "first",
    },
  );
  assert.throws(
    () => sessions(turn("second"), async () => ({})),
    /approved turns are spent/,
  );
  assert.deepEqual(opened, ["first"]);
});

test("a turn that cannot record its spending is refused, never counted as spent", (t) => {
  const directory = state(t);
  const approval = approve(directory, prepare(directory, 1));
  rmSync(directory, { recursive: true, force: true });
  assert.throws(
    () => approval.spend(deliveryId),
    (error) => error.code === "ENOENT",
  );
});
