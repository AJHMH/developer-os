import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { DeliveryController } from "../dist/controller.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";

async function repairFixture(t) {
  const f = codingFixture(t);
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
  return f;
}
function reopen(f) {
  return new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
  });
}
test("a repair batch uses the admitted candidate, revalidates it and retains separate durable usage", async (t) => {
  const f = await repairFixture(t);
  const before = f.controller.status(f.delivery.id);
  const result = await f.controller.repairFeature(f.delivery.id);
  assert.equal(result.repair.attempts.length, 1);
  assert.equal(result.repair.attempts[0].outcome, "passed");
  assert.equal(result.repair.allowanceCycles, 3);
  assert.equal(result.repair.allowanceMs, 3600000);
  assert.equal(result.repair.activeMs, 110);
  assert.equal(result.feature.activeMs, before.feature.activeMs);
  assert.equal(result.feature.candidate.validation, "passed");
  assert.match(f.runtime.request.files[0].bytes.toString(), /Say hello/);
  assert.match(f.runtime.request.argv.at(-1), /acceptance/);
  assert.equal(reopen(f).status(f.delivery.id).repair.activeMs, 110);
});

test("failed batches consume three cycles across restart and only an owner extension permits another", async (t) => {
  const f = await repairFixture(t);
  const collect = f.runtime.collect.bind(f.runtime);
  let revision = 0;
  f.runtime.collect = async (r) => {
    const output = await collect(r),
      file = output.files[0];
    file.bytes = Buffer.from("candidate " + ++revision);
    file.beforeSha256 = file.afterSha256 = createHash("sha256")
      .update(file.bytes)
      .digest("hex");
    return output;
  };
  const execute = f.validation.execute.bind(f.validation);
  f.validation.execute = async (r) => ({
    ...(await execute(r)),
    status: r.check.id === "acceptance" ? "failure" : "success",
  });
  for (let i = 0; i < 3; i++) {
    f.controller = reopen(f);
    const d = await f.controller.repairFeature(f.delivery.id, [
      "New review finding " + i,
    ]);
    assert.equal(d.repair.attempts.length, i + 1);
    assert.equal(d.repair.attempts.at(-1).outcome, "failed");
  }
  const exhausted = await f.controller.repairFeature(f.delivery.id, [
    "Another comment",
  ]);
  assert.equal(exhausted.repair.attempts.length, 3);
  assert.match(exhausted.blocker.nextAction, /exhausted/);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /repair|coding/i,
  );
  await assert.rejects(
    f.controller.validateCandidate(f.delivery.id),
    /repair|Validation/i,
  );
  f.controller.extendRepair(f.delivery.id, 1, 0);
  const final = await reopen(f).repairFeature(f.delivery.id);
  assert.equal(final.repair.attempts.length, 4);
  assert.equal(final.repair.activeMs, 440);
  assert.equal(final.repair.extensions[0].addedCycles, 1);
});

test("local revalidation reaches the exact 60-minute boundary and cannot report success", async (t) => {
  const f = await repairFixture(t);
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (r) => {
    f.now += 3599890;
    return execute(r);
  };
  const d = await f.controller.repairFeature(f.delivery.id);
  assert.equal(d.repair.activeMs, 3600000);
  assert.equal(d.repair.attempts[0].outcome, "exhausted");
  assert.equal(d.feature.candidate.validation, "not-run");
  assert.equal(d.feature.activeMs, 50);
  f.controller.extendRepair(f.delivery.id, 0, 1);
  assert.equal(reopen(f).status(f.delivery.id).repair.allowanceMs, 3660000);
});

test("pause during repair charges active editing but excludes pause and prevents late admission", async (t) => {
  const f = await repairFixture(t);
  const execute = f.runtime.execute.bind(f.runtime);
  let started, done;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const pending = new Promise((resolve) => {
    done = resolve;
  });
  f.runtime.execute = async (r) => {
    f.now += 200;
    r.checkpoint();
    started();
    await pending;
    return execute(r);
  };
  const work = f.controller.repairFeature(f.delivery.id);
  await entered;
  const paused = await f.controller.pause(f.delivery.id);
  assert.equal(paused.repair.activeMs, 200);
  assert.equal(paused.repair.attempts[0].outcome, "interrupted");
  f.now += 1000000;
  done();
  await work;
  assert.equal(f.controller.status(f.delivery.id).repair.activeMs, 200);
  f.controller.resume(f.delivery.id);
  assert.equal(f.controller.status(f.delivery.id).repair.attempts.length, 1);
});

test("restart preserves active usage and blocks overlap until uncertain descendants stop", async (t) => {
  const f = await repairFixture(t);
  let started, done;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const pending = new Promise((resolve) => {
    done = resolve;
  });
  f.runtime.execute = async (r) => {
    f.now += 400;
    r.checkpoint();
    started();
    await pending;
    throw Error("interrupted");
  };
  const stop = f.runtime.stop.bind(f.runtime);
  f.runtime.stop = async (r) => ({
    ...(await stop(r)),
    stopped: false,
    remainingProcesses: 1,
  });
  const work = f.controller.repairFeature(f.delivery.id);
  await entered;
  const resumed = reopen(f);
  f.now += 500000;
  const uncertain = await resumed.recover(f.delivery.id);
  assert.equal(uncertain.repair.activeMs, 400);
  assert.equal(uncertain.repair.attempts[0].state, "uncertain");
  await assert.rejects(resumed.repairFeature(f.delivery.id), /stopped/);
  assert.throws(() => resumed.release(f.delivery.id), /Recover/);
  f.runtime.stop = stop;
  const recovered = await resumed.recover(f.delivery.id);
  assert.equal(recovered.repair.attempts[0].state, "stopped");
  assert.equal(recovered.repair.activeMs, 400);
  done();
  await work;
  assert.equal(resumed.status(f.delivery.id).repair.activeMs, 400);
});

test("a last check returning success at the deadline cannot admit exhausted repair evidence", async (t) => {
  const f = await repairFixture(t);
  const execute = f.validation.execute.bind(f.validation);
  f.validation.execute = async (r) => {
    const result = await execute(r);
    if (r.check.id === "acceptance") f.now += 3600000 - 110;
    return result;
  };
  const d = await f.controller.repairFeature(f.delivery.id);
  assert.equal(d.repair.attempts[0].outcome, "exhausted");
  assert.equal(d.feature.candidate.validation, "not-run");
});

test("repair cannot weaken protected validation files or overwrite the retained candidate", async (t) => {
  const f = await repairFixture(t),
    before = f.controller.status(f.delivery.id).feature.candidate.sha256;
  const collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (r) => {
    const output = await collect(r),
      bytes = Buffer.from('{"scripts":{"test":"exit 0"}}');
    const hash = createHash("sha256").update(bytes).digest("hex");
    output.files.push({
      path: "package.json",
      bytes,
      ordinary: true,
      links: 1,
      beforeSha256: hash,
      afterSha256: hash,
    });
    return output;
  };
  const d = await f.controller.repairFeature(f.delivery.id, [
    "Skip the failing check",
  ]);
  assert.equal(d.repair.attempts[0].outcome, "failed");
  assert.equal(d.feature.candidate.sha256, before);
  assert.equal(d.validation.attempts.length, 2);
});

test("baseline failures and unvalidated candidates cannot start repair or consume cycles", async (t) => {
  const f = codingFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await assert.rejects(
    f.controller.repairFeature(f.delivery.id),
    /candidate validation/,
  );
  await f.controller.validateBaseline(f.delivery.id);
  await assert.rejects(
    f.controller.repairFeature(f.delivery.id),
    /candidate validation/,
  );
  await f.controller.codeFeature(f.delivery.id);
  await assert.rejects(
    f.controller.repairFeature(f.delivery.id),
    /candidate validation/,
  );
  assert.equal(f.controller.status(f.delivery.id).repair, undefined);
});

test("owner extensions reject active or unexhausted repairs and malformed amounts", async (t) => {
  const f = await repairFixture(t);
  for (const values of [
    [-1, 1],
    [1, -1],
    [0, 0],
    [101, 0],
    [0, 1441],
    [0.5, 0],
    [NaN, 0],
  ]) {
    assert.throws(
      () => f.controller.extendRepair(f.delivery.id, ...values),
      /Extend repair/,
    );
  }
  assert.throws(
    () => f.controller.extendRepair(f.delivery.id, 1, 1),
    /stopped exhausted/,
  );
  await f.controller.repairFeature(f.delivery.id);
  assert.throws(
    () => f.controller.extendRepair(f.delivery.id, 1, 1),
    /stopped exhausted/,
  );
});

test("findings are bounded untrusted text, never extension or control authority", async (t) => {
  const f = await repairFixture(t);
  for (const batch of [
    null,
    ["\n"],
    ["x".repeat(2001)],
    Array(33).fill("finding"),
  ]) {
    await assert.rejects(
      f.controller.repairFeature(f.delivery.id, batch),
      /findings|iterable/,
    );
  }
  assert.equal(f.controller.status(f.delivery.id).repair, undefined);
});

test("CLI exposes repair and rejects invalid extension options without installing a native runtime", async (t) => {
  const f = await repairFixture(t);
  const { spawnSync } = await import("node:child_process");
  const run = (args) =>
    spawnSync(
      process.execPath,
      ["dist/cli.js", ...args, "--state-dir", f.state, "--id", f.delivery.id],
      { encoding: "utf8" },
    );
  const invalid = run(["extend-repair", "--cycles", "101"]);
  assert.notEqual(invalid.status, 0);
  const valid = run(["repair-feature"]);
  assert.equal(valid.status, 0, valid.stderr);
  const status = JSON.parse(valid.stdout);
  assert.equal(status.repair.attempts[0].outcome, "failed");
  assert.equal(status.feature.candidate.validation, "not-run");
});

test("the remaining repair deadline stops a hung local check before its longer declared timeout", async (t) => {
  const f = await repairFixture(t);
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (r) => {
    f.now += 3599940;
    return execute(r);
  };
  let checks = 0;
  f.validation.execute = async () => {
    checks++;
    return new Promise(() => {});
  };
  const d = await f.controller.repairFeature(f.delivery.id);
  assert.equal(d.repair.activeMs, 3600000);
  assert.equal(d.repair.attempts[0].outcome, "exhausted");
  assert.equal(d.validation.attempts.at(-1).state, "stopped");
  assert.equal(d.validation.attempts.at(-1).outcome, "incomplete");
  assert.equal(checks, 1);
});

test("cancel during local revalidation charges that time and cannot authorize a late success", async (t) => {
  const f = await repairFixture(t);
  const execute = f.validation.execute.bind(f.validation);
  f.validation.execute = async (r) => {
    const result = await execute(r);
    f.now += 30;
    await f.controller.cancel(f.delivery.id);
    return result;
  };
  const d = await f.controller.repairFeature(f.delivery.id);
  assert.equal(d.phase, "cancelled");
  assert.equal(d.repair.activeMs, 90);
  assert.equal(d.repair.attempts[0].outcome, "interrupted");
  assert.equal(d.feature.candidate.validation, "not-run");
  await assert.rejects(f.controller.repairFeature(f.delivery.id), /stopped/);
});

test("an unchanged repair still revalidates once and retains the unexplained original failure", async (t) => {
  const f = await repairFixture(t);
  f.runtime.collect = async (r) => {
    const bytes = Buffer.from("<h1>Contact</h1><p>Say hello</p>\n");
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
  const d = await f.controller.repairFeature(f.delivery.id);
  assert.equal(d.repair.attempts[0].outcome, "failed");
  assert.equal(d.validation.attempts.at(-1).outcome, "flaky");
  assert.equal(d.validation.attempts[1].outcome, "failed");
  assert.equal(
    d.repair.attempts[0].validationOperationId,
    d.validation.attempts.at(-1).operationId,
  );
});

test("interrupted final inspection cannot strand validation or attach old evidence to a new repair", async (t) => {
  const f = await repairFixture(t);
  const inspect = f.validation.inspect.bind(f.validation);
  let count = 0,
    entered,
    release;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  f.validation.inspect = async () => {
    if (++count === 3) {
      entered();
      await hold;
    }
    return inspect();
  };
  const first = f.controller.repairFeature(f.delivery.id);
  await waiting;
  await f.controller.pause(f.delivery.id);
  f.controller.resume(f.delivery.id);
  const second = await f.controller.repairFeature(f.delivery.id, [
    "Retained review finding",
  ]);
  const secondId = second.repair.attempts[1].validationOperationId;
  assert.ok(secondId);
  assert.notEqual(secondId, second.repair.attempts[0].validationOperationId);
  release();
  await first;
  assert.equal(
    f.controller.status(f.delivery.id).repair.attempts[1].validationOperationId,
    secondId,
  );
});
