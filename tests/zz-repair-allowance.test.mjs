// The owner's repair allowance at start (#266): cycles and active minutes the
// owner sets, defaulting to three cycles or 60 minutes. The name sorts after
// every other test file, so no other file changes shard.
import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";

/** A delivery whose candidate failed its acceptance check, started with
 * `startOptions`; the next repair fixes it. */
async function failedCandidate(t, startOptions) {
  const f = codingFixture(t, () => {}, startOptions);
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  await f.controller.codeFeature(f.delivery.id);
  const execute = f.validation.execute.bind(f.validation);
  f.validation.execute = async (r) => ({
    ...(await execute(r)),
    status: r.check.id === "acceptance" ? "failure" : "success",
  });
  await f.controller.validateCandidate(f.delivery.id);
  f.validation.execute = async (r) => {
    f.now += 10;
    return execute(r);
  };
  f.runtime.collect = async (r) => {
    const bytes = Buffer.from("<h1>Contact</h1><p>Fixed hint</p>\n");
    const hash = createHash("sha256").update(bytes).digest("hex");
    return {
      operationId: r.operationId,
      fence: r.fence,
      complete: true,
      files: [
        {
          path: "index.html",
          bytes,
          ordinary: true,
          links: 1,
          beforeSha256: hash,
          afterSha256: hash,
        },
      ],
    };
  };
  f.reopen = () =>
    new DeliveryController(f.state, f.options, {
      featurePlanner: f.criteria,
      featureRuntime: f.runtime,
      messagesSessions: f.messagesSessions,
      validationRuntime: f.validation,
      clock: () => f.now,
    });
  return f;
}

test("a one-cycle allowance repairs once, then reports itself exhausted until an owner extension", async (t) => {
  const f = await failedCandidate(t, { repairCycles: 1 });
  assert.deepEqual(f.controller.status(f.delivery.id).initialRepairAllowance, {
    cycles: 1,
    ms: 3600000,
  });
  const repaired = await f.controller.repairFeature(f.delivery.id);
  assert.equal(repaired.repair.allowanceCycles, 1);
  assert.equal(repaired.repair.allowanceMs, 3600000);
  assert.equal(repaired.repair.attempts.length, 1);
  assert.equal(repaired.repair.attempts[0].outcome, "passed");
  assert.equal(repaired.repair.attempts[0].remainingCycles, 0);
  assert.equal(repaired.feature.candidate.validation, "passed");
  // The spent allowance is reported before anything else, after a restart
  // too, and no attempt is recorded.
  const launches = f.messagesTurns.length;
  const exhausted = await f.reopen().repairFeature(f.delivery.id);
  assert.equal(exhausted.repair.attempts.length, 1);
  assert.match(exhausted.blocker.nextAction, /Repair allowance exhausted/);
  assert.equal(f.messagesTurns.length, launches, "no turn was sent");
  const extended = f.reopen().extendRepair(f.delivery.id, 1, 0);
  assert.equal(extended.repair.allowanceCycles, 2);
  assert.equal(extended.repair.extensions[0].addedCycles, 1);
});

test("the owner's repair minutes bound active repair time", async (t) => {
  const f = await failedCandidate(t, { repairMinutes: 1 });
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (r) => {
    f.now += 60000;
    return execute(r);
  };
  const result = await f.controller.repairFeature(f.delivery.id);
  assert.equal(result.repair.allowanceCycles, 3);
  assert.equal(result.repair.allowanceMs, 60000);
  assert.notEqual(result.repair.attempts[0].outcome, "passed");
  assert.equal(result.repair.attempts[0].remainingMs, 0);
});

test("without owner amounts the allowance stays three cycles or 60 minutes", async (t) => {
  const f = await failedCandidate(t, {});
  assert.equal(
    f.controller.status(f.delivery.id).initialRepairAllowance,
    undefined,
  );
  const repaired = await f.controller.repairFeature(f.delivery.id);
  assert.equal(repaired.repair.allowanceCycles, 3);
  assert.equal(repaired.repair.allowanceMs, 3600000);
});

test("start refuses repair amounts outside their bounds", (t) => {
  const f = codingFixture(t);
  for (const amounts of [
    { repairCycles: 0 },
    { repairCycles: 101 },
    { repairCycles: 1.5 },
    { repairMinutes: 0 },
    { repairMinutes: 1441 },
  ])
    assert.throws(
      () =>
        f.controller.start({
          repository: f.repository,
          request: "Another request.",
          ...amounts,
        }),
      /Declare 1 to 100 repair cycles and 1 to 1440 repair minutes/,
    );
});

test("the CLI start takes the owner's repair cycles and minutes", (t) => {
  const f = codingFixture(t);
  const state = realpathSync(mkdtempSync(join(tmpdir(), "aios-repair-cli-")));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const cli = (...args) =>
    spawnSync(
      process.execPath,
      [
        new URL("../dist/cli.js", import.meta.url).pathname,
        ...args,
        "--state-dir",
        state,
      ],
      { encoding: "utf8" },
    );
  const started = cli(
    "start",
    "--repo",
    f.repository,
    "--request",
    "Add a visible contact hint.",
    "--repair-cycles",
    "1",
    "--repair-minutes",
    "30",
  );
  assert.equal(started.status, 0, started.stderr);
  assert.deepEqual(JSON.parse(started.stdout).initialRepairAllowance, {
    cycles: 1,
    ms: 1800000,
  });
  for (const bad of [
    ["--repair-cycles", "0"],
    ["--repair-cycles", "101"],
    ["--repair-minutes", "1441"],
    ["--repair-minutes", "x"],
  ])
    assert.notEqual(
      cli("start", "--repo", f.repository, "--request", "Other.", ...bad)
        .status,
      0,
    );
});
test("each coding turn names its files by their manifest digest, as the native runtime checks, a repair's candidate included", async (t) => {
  const f = await failedCandidate(t, {});
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const sent = [];
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = (request, gateway) => {
    sent.push(request.inputSha256);
    // Like the native transport, before anything reaches the guest.
    const manifest = request.files.map(({ path, bytes, executable }) => ({
      path,
      sha256: sha(bytes),
      executable,
    }));
    assert.equal(request.inputSha256, sha(JSON.stringify(manifest)));
    return execute(request, gateway);
  };
  const candidate = f.controller.status(f.delivery.id).feature.candidate;
  const repaired = await f.controller.repairFeature(f.delivery.id);
  assert.equal(repaired.repair.attempts[0].outcome, "passed");
  assert.equal(sent.length, 1);
  // The repair itself is still named by the candidate artifact it repaired.
  assert.equal(repaired.repair.attempts[0].inputSha256, candidate.sha256);
  assert.notEqual(sent[0], candidate.sha256);
});
