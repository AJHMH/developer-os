import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DeliveryController } from "../dist/controller.js";
import {
  admitRequest,
  chargeResponse,
  dollarsToPicodollars,
  extendBudget,
  newSpendLedger,
  pinnedModelPrices,
  picodollarsToDollars,
  releaseRequest,
  remaining,
  requestReserve,
  usageCost,
} from "../dist/spend-budget.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";

const dollar = 1e12;

test("the pinned model is Claude Opus 5.5 at its first-party prices", () => {
  assert.deepEqual(
    { ...pinnedModelPrices },
    {
      model: "claude-opus-5-5",
      input: 4e6,
      output: 20e6,
      cacheWrite5m: 5e6,
      cacheWrite1h: 8e6,
      cacheRead: 0.2e6,
    },
  );
});

test("a response costs exactly its tokens at each rate", () => {
  // 1M input at $4, 100k output at $20, 2M cache reads at $0.20.
  assert.equal(
    usageCost({
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 2_000_000,
    }),
    4 * dollar + 2 * dollar + 0.4 * dollar,
  );
  // Cache writes split by TTL, or charged at the one-hour rate without a split.
  assert.equal(
    usageCost({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 300,
      cache_creation: {
        ephemeral_5m_input_tokens: 100,
        ephemeral_1h_input_tokens: 200,
      },
    }),
    100 * 5e6 + 200 * 8e6,
  );
  assert.equal(
    usageCost({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 300,
    }),
    300 * 8e6,
  );
  assert.equal(
    usageCost({
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
    }),
    24e6,
  );
});

test("malformed usage is refused rather than charged as free", () => {
  for (const bad of [
    undefined,
    { output_tokens: 1 },
    { input_tokens: -1, output_tokens: 0 },
    { input_tokens: 1.5, output_tokens: 0 },
    { input_tokens: 0, output_tokens: "9" },
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: -2 },
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 10,
      cache_creation: {
        ephemeral_5m_input_tokens: 4,
        ephemeral_1h_input_tokens: 4,
      },
    },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 },
  ])
    assert.throws(() => usageCost(bad), /Unverified model usage/);
});

test("a request reserves its worst case, at the dearer write rate only when it uses long cache writes", () => {
  assert.equal(
    requestReserve({
      inputTokens: 1000,
      maxOutputTokens: 500,
      longCacheWrites: false,
    }),
    1000 * 5e6 + 500 * 20e6,
  );
  assert.equal(
    requestReserve({
      inputTokens: 1000,
      maxOutputTokens: 500,
      longCacheWrites: true,
    }),
    1000 * 8e6 + 500 * 20e6,
  );
  assert.throws(
    () =>
      requestReserve({
        inputTokens: -1,
        maxOutputTokens: 1,
        longCacheWrites: false,
      }),
    /Unverified/,
  );
});

test("the ledger admits one request at a time, charges actual cost and never overruns", () => {
  const ledger = newSpendLedger(1 * dollar);
  assert.equal(ledger.budget, dollar);
  assert.deepEqual(admitRequest(ledger, "op-1", 0.6 * dollar, "t"), {
    admitted: true,
  });
  assert.throws(() => admitRequest(ledger, "op-2", 1, "t"), /outstanding/);
  assert.equal(remaining(ledger), 0.4 * dollar);
  assert.deepEqual(
    chargeResponse(ledger, "op-1", {
      input_tokens: 10_000,
      output_tokens: 1_000,
    }),
    { cost: 10_000 * 4e6 + 1_000 * 20e6, overrun: false },
  );
  assert.equal(ledger.spent, 0.06 * dollar);
  assert.equal(ledger.charges, 1);
  assert.throws(
    () => chargeResponse(ledger, "op-1", { input_tokens: 0, output_tokens: 0 }),
    /No such/,
  );
  // A request whose worst case exceeds what is left is a budget interruption.
  const refused = admitRequest(
    ledger,
    "op-3",
    0.95 * dollar,
    "2026-11-08T00:00:00.000Z",
  );
  assert.deepEqual(refused, {
    admitted: false,
    needed: 0.95 * dollar,
    remaining: 0.94 * dollar,
  });
  assert.deepEqual(ledger.interruption, {
    at: "2026-11-08T00:00:00.000Z",
    needed: 0.95 * dollar,
    remaining: 0.94 * dollar,
  });
  // Even a small request stays refused until the owner extends the budget.
  assert.equal(admitRequest(ledger, "op-4", 1, "t").admitted, false);
  extendBudget(ledger, 0.5 * dollar, "t2");
  assert.equal(ledger.interruption, undefined);
  assert.deepEqual(ledger.extensions, [{ added: 0.5 * dollar, at: "t2" }]);
  assert.equal(admitRequest(ledger, "op-5", 0.95 * dollar, "t").admitted, true);
  releaseRequest(ledger, "op-5");
  assert.equal(ledger.reserved, undefined);
  assert.throws(() => releaseRequest(ledger, "op-5"), /No such/);
  assert.throws(() => extendBudget(ledger, 0), /Invalid/);
  assert.throws(() => admitRequest(ledger, "bad id!", 1), /Unverified/);
  // A response dearer than its reservation is charged in full and reported.
  admitRequest(ledger, "op-6", 1, "t");
  assert.equal(
    chargeResponse(ledger, "op-6", { input_tokens: 1, output_tokens: 0 })
      .overrun,
    true,
  );
});

test("budgets are whole cents from $0.01 to $1000", () => {
  assert.equal(dollarsToPicodollars(10), 10 * dollar);
  assert.equal(dollarsToPicodollars(0.01), 0.01 * dollar);
  assert.equal(dollarsToPicodollars(12.34), 1234 * 1e10);
  for (const bad of [0, 0.001, 10.555, 1000.01, -1, Number.NaN, "5"])
    assert.throws(() => dollarsToPicodollars(bad), /whole cents/);
  assert.equal(picodollarsToDollars(1234 * 1e10), "$12.340000");
});

test("the controller keeps each delivery's budget, refuses past it and resumes on an owner extension", (t) => {
  const f = codingFixture(t);
  const id = f.delivery.id;
  let r = f.controller.admitModelRequest(id, "op-1", 3 * dollar);
  assert.equal(r.admitted, true);
  assert.equal(r.delivery.spend.budget, 10 * dollar);
  f.controller.chargeModelResponse(id, "op-1", {
    input_tokens: 500_000,
    output_tokens: 200_000,
  });
  assert.equal(f.controller.status(id).spend.spent, 6 * dollar);
  r = f.controller.admitModelRequest(id, "op-2", 5 * dollar);
  assert.equal(r.admitted, false);
  assert.match(
    r.delivery.blocker.message,
    /Budget interruption.*\$5\.000000.*\$4\.000000/,
  );
  assert.match(r.delivery.blocker.nextAction, /extend-budget/);
  // The ledger survives a reopen.
  const reopened = new DeliveryController(f.state, f.options);
  assert.equal(reopened.status(id).spend.interruption.needed, 5 * dollar);
  const extended = f.controller.extendBudget(id, 2.5);
  assert.equal(extended.spend.budget, 12.5 * dollar);
  assert.equal(extended.spend.interruption, undefined);
  assert.doesNotMatch(extended.blocker.message, /Budget interruption/);
  assert.equal(
    f.controller.admitModelRequest(id, "op-3", 5 * dollar).admitted,
    true,
  );
  f.controller.releaseModelRequest(id, "op-3");
  assert.throws(() => f.controller.extendBudget(id, 0.001), /whole cents/);
});

test("a delivery started with its own budget uses it", (t) => {
  const f = codingFixture(t);
  const d = f.controller.start({
    repository: f.repository,
    request: "Another hint.",
    budgetDollars: 2.5,
  });
  assert.equal(d.initialSpendBudget, 2.5 * dollar);
  assert.throws(
    () =>
      f.controller.start({
        repository: f.repository,
        request: "x",
        budgetDollars: 5000,
      }),
    /whole cents/,
  );
});

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
test("the CLI takes budgets only as whole cents", (t) => {
  const state = realpathSync(mkdtempSync(join(tmpdir(), "aios-budget-cli-")));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  for (const args of [
    ["extend-budget", "--id", "x", "--dollars", "1.234"],
    ["extend-budget", "--id", "x", "--dollars", "-1"],
    ["extend-budget", "--id", "x"],
    ["start", "--repo", state, "--request", "x", "--budget-dollars", "abc"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [cli, ...args, "--state-dir", state],
      {
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /extend-budget|budget-dollars/);
  }
});

test("a cache-write breakdown may name only one TTL", () => {
  assert.equal(
    usageCost({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 50 },
    }),
    50 * 5e6,
  );
  assert.equal(
    usageCost({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_1h_input_tokens: 50 },
    }),
    50 * 8e6,
  );
});

test("a delivery waiting behind the repository owner can neither spend nor be extended", (t) => {
  const f = codingFixture(t);
  const queued = f.controller.start({
    repository: f.repository,
    request: "A second request for the same repository.",
  });
  assert.equal(queued.ownership.held, false);
  assert.throws(
    () => f.controller.admitModelRequest(queued.id, "op-1", 1),
    /repository owner delivery may spend/,
  );
  assert.throws(
    () => f.controller.extendBudget(queued.id, 1),
    /repository owner delivery may receive/,
  );
});

test("the CLI starts a delivery with the owner's budget", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-budget-start-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "start",
      "--repo",
      root,
      "--request",
      "Add a hint.",
      "--budget-dollars",
      "2.5",
      "--state-dir",
      join(root, "..", root.split("/").at(-1) + "-state"),
    ],
    { encoding: "utf8" },
  );
  t.after(() =>
    rmSync(join(root, "..", root.split("/").at(-1) + "-state"), {
      recursive: true,
      force: true,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).initialSpendBudget, 2.5 * dollar);
});
