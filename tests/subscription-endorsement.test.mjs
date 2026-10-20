import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { endorseUsageAccount } from "../dist/subscription-endorsement.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { mediatedCoding } from "./helpers/mediation-fixture.mjs";
import { ownWindowsFixturePaths } from "./helpers/windows-fixture-owner.mjs";

const usageAccount = createHash("sha256")
  .update("owner@example.test")
  .digest("hex");

// A delivery whose protected mediation record still awaits endorsement, and
// a usage reader reporting the owner's measured subscription.
async function awaitingEndorsement(t) {
  const f = codingFixture(t);
  const { recordPath } = await mediatedCoding(f, t, undefined);
  const observation = {
    observedAt: new Date().toISOString(),
    accountId: usageAccount,
    authMode: "chatgpt",
    windows: [
      {
        id: "primary",
        usedPercent: 10,
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
      },
    ],
    exhausted: false,
  };
  const endorse = (overrides = {}) =>
    endorseUsageAccount({
      state: f.state,
      deliveryId: f.delivery.id,
      reader: async () => structuredClone(observation),
      ...overrides,
    });
  const decision = async () => {
    ownWindowsFixturePaths([recordPath]);
    return (await f.controller.qualify(f.delivery.id)).qualification
      .subscriptionMediation.mechanismDecision;
  };
  return { f, recordPath, observation, endorse, decision };
}

test("a confirmed endorsement binds the observed usage account so the decision qualifies", async (t) => {
  const { f, recordPath, endorse, decision } = await awaitingEndorsement(t);
  const before = readFileSync(recordPath);
  const preview = await endorse();
  assert.deepEqual(preview, {
    usageAccountId: usageAccount,
    written: false,
    alreadyEndorsed: false,
  });
  assert.deepEqual(
    readFileSync(recordPath),
    before,
    "a dry run writes nothing",
  );
  assert.equal(await decision(), undefined);
  const confirmed = await endorse({
    confirm: true,
    expectedUsageAccountId: usageAccount,
  });
  assert.deepEqual(confirmed, {
    usageAccountId: usageAccount,
    written: true,
    alreadyEndorsed: false,
  });
  assert.equal((await decision()).usageAccountId, usageAccount);
  assert.deepEqual(
    readdirSync(f.state).filter((name) => name.startsWith(".pending")),
    [],
    "no temporary file remains",
  );
  assert.deepEqual(
    await endorse({ confirm: true, expectedUsageAccountId: usageAccount }),
    { usageAccountId: usageAccount, written: false, alreadyEndorsed: true },
    "re-endorsing the same account changes nothing",
  );
});

test("on Windows the endorsement rewrites the record in place to keep its owner", async (t) => {
  const { recordPath, endorse, decision } = await awaitingEndorsement(t);
  const before = statSync(recordPath).ino;
  // Linux runs the Windows write path too; the hosted Windows shard runs it
  // natively.
  const result = await endorse({
    confirm: true,
    expectedUsageAccountId: usageAccount,
    platform: "win32",
  });
  assert.equal(result.written, true);
  assert.equal(statSync(recordPath).ino, before, "the same file was rewritten");
  assert.equal((await decision()).usageAccountId, usageAccount);
});

for (const [name, reason, arrange] of [
  [
    "a write without the previewed account",
    "previewed usage account",
    () => ({
      expectedUsageAccountId: undefined,
    }),
  ],
  [
    "an invalid delivery id",
    "delivery id is invalid",
    () => ({ deliveryId: "not-a-delivery" }),
  ],
  [
    "a failing usage reader",
    "no fresh, measured",
    () => ({
      reader: async () => {
        throw Error("unavailable");
      },
    }),
  ],
  [
    "a record that cannot be replaced",
    "could not be written",
    (e) => ({
      // The record path becomes a directory after it was read, so the rename
      // fails and the endorsement must not report success.
      reader: async () => {
        rmSync(e.recordPath);
        mkdirSync(e.recordPath);
        return structuredClone(e.observation);
      },
    }),
  ],
  [
    "no usage observation",
    "no fresh, measured",
    (e) => ({ reader: async () => undefined }),
  ],
  [
    "an unmeasured observation",
    "no fresh, measured",
    (e) => ({ reader: async () => ({ ...e.observation, windows: [] }) }),
  ],
  [
    "a stale observation",
    "no fresh, measured",
    (e) => ({
      reader: async () => ({
        ...e.observation,
        observedAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    }),
  ],
  [
    "an unexpected account",
    "not the expected one",
    () => ({ expectedUsageAccountId: "f".repeat(64) }),
  ],
  [
    "another delivery",
    "missing, unreadable or not private",
    () => ({ deliveryId: randomUUID() }),
  ],
  [
    "a record that is not this delivery's decision",
    "not a mediation decision",
    (e) => {
      const record = JSON.parse(readFileSync(e.recordPath));
      writeFileSync(
        e.recordPath,
        JSON.stringify({ ...record, deliveryId: randomUUID() }),
        { mode: 0o600 },
      );
      return {};
    },
  ],
  [
    "a record endorsed for another account",
    "already endorsed for another",
    (e) => {
      const record = JSON.parse(readFileSync(e.recordPath));
      writeFileSync(
        e.recordPath,
        JSON.stringify({ ...record, usageAccountId: "e".repeat(64) }),
        { mode: 0o600 },
      );
      return {};
    },
  ],
])
  test(`endorsement refuses ${name} and writes nothing`, async (t) => {
    const e = await awaitingEndorsement(t);
    const overrides = arrange(e);
    const before = readFileSync(e.recordPath);
    const replaced = name === "a record that cannot be replaced";
    await assert.rejects(
      e.endorse({
        confirm: true,
        expectedUsageAccountId: usageAccount,
        ...overrides,
      }),
      (error) =>
        error.name === "EndorsementRefusal" && error.message.includes(reason),
    );
    if (!replaced) assert.deepEqual(readFileSync(e.recordPath), before);
    assert.deepEqual(
      readdirSync(e.f.state).filter((entry) => entry.startsWith(".pending")),
      [],
    );
  });

test(
  "endorsement refuses a decision record readable by others",
  {
    skip:
      process.platform === "win32" &&
      "POSIX permission bits; Windows uses owner ACLs",
  },
  async (t) => {
    const e = await awaitingEndorsement(t);
    chmodSync(e.recordPath, 0o644);
    const before = readFileSync(e.recordPath);
    await assert.rejects(
      e.endorse({ confirm: true, expectedUsageAccountId: usageAccount }),
      { name: "EndorsementRefusal" },
    );
    assert.deepEqual(readFileSync(e.recordPath), before);
  },
);

test("the endorsement command needs explicit inputs and the previewed account to write", () => {
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["scripts/endorse-subscription-usage.mjs", ...args],
      { encoding: "utf8" },
    );
  const inputs = [
    "--state-dir",
    "/nonexistent",
    "--delivery",
    randomUUID(),
    "--codex-executable",
    "/nonexistent/codex",
  ];
  for (const [args, message] of [
    [[], /are required/],
    [inputs.slice(0, 4), /are required/],
    [[...inputs, "--confirm", "yes"], /--confirm true/],
    [[...inputs, "--confirm", "true"], /--expect/],
    [["--unknown", "value"], /Unknown option/],
    [inputs, /Usage endorsement refused: the decision record is missing/],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, message);
  }
});
