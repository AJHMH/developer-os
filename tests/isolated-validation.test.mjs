import { ownerValidationContract } from "./helpers/validation-fixture.mjs";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, readFileSync } from "node:fs";
import { DeliveryController } from "../dist/controller.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";

function validationFixture(t, configure = () => {}) {
  const f = codingFixture(t);
  const policy = JSON.parse(readFileSync(f.options.policyPath));
  policy.validationContract = ownerValidationContract();
  configure(policy);
  writeFileSync(f.options.policyPath, JSON.stringify(policy));
  f.validation = {
    mode: "controlled",
    bindingSha256: "3".repeat(64),
    async inspect() {
      return {
        mode: this.mode,
        bindingSha256: this.bindingSha256,
        environment: policy.validationContract.environment,
      };
    },
    async execute(request) {
      assert.equal(request.mayDispatch(), true);
      return {
        checkId: request.check.id,
        status: "success",
        publisher: "isolated-checker",
        treeSha256: request.treeSha256,
        environmentSha256: request.environmentSha256,
        artifacts: [],
      };
    },
    async stop(request) {
      return {
        operationId: request.operationId,
        fence: request.fence,
        stopped: true,
        remainingProcesses: 0,
        treeSha256: request.treeSha256,
      };
    },
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    validationRuntime: f.validation,
  });
  // The changed owner policy belongs to a new request, never silently replaces old authority.
  f.controller.release(f.delivery.id);
  f.delivery = f.controller.start({
    repository: f.repository,
    request: "Add a visible contact hint.",
  });
  f.policy = policy;
  return f;
}

test("unchanged-main validation retains revision-bound check evidence across ledger reopening", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  const validated = await f.controller.validateBaseline(f.delivery.id);
  const attempt = validated.validation.attempts[0];
  assert.equal(attempt.stage, "baseline");
  assert.equal(attempt.sourceRevision, f.git("rev-parse", "HEAD"));
  assert.equal(attempt.outcome, "passed");
  assert.equal(attempt.state, "stopped");
  assert.deepEqual(
    attempt.results.map((r) => r.checkId),
    ["format", "lint", "type", "coverage", "build"],
  );
  assert.deepEqual(
    new DeliveryController(f.state).status(f.delivery.id).validation,
    validated.validation,
  );
  assert.equal(f.git("branch", "--show-current"), "main");
});

test("coding requires unchanged-main evidence and candidate checks bind the admitted manifest", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /baseline|unchanged main/i,
  );
  assert.equal(f.runtime.request, undefined);
  await f.controller.validateBaseline(f.delivery.id);
  const coded = await f.controller.codeFeature(f.delivery.id);
  const validated = await f.controller.validateCandidate(f.delivery.id);
  const attempt = validated.validation.attempts.at(-1);
  assert.equal(attempt.stage, "candidate");
  assert.equal(attempt.treeSha256, coded.feature.candidate.sha256);
  assert.equal(attempt.outcome, "passed");
  assert.equal(validated.feature.candidate.validation, "passed");
  assert.equal(validated.blocker.code, "DELIVERY_NOT_ENABLED");
});

for (const status of [
  "failure",
  "missing",
  "pending",
  "skipped",
  "neutral",
  "cancelled",
])
  test(`required ${status} evidence blocks coding and one successful retry cannot conceal it`, async (t) => {
    const f = validationFixture(t);
    const execute = f.validation.execute.bind(f.validation);
    f.validation.execute = async (r) => ({
      ...(await execute(r)),
      status: r.check.id === "lint" ? status : "success",
    });
    await f.controller.planFeature(f.delivery.id);
    const first = await f.controller.validateBaseline(f.delivery.id);
    assert.notEqual(first.validation.attempts[0].outcome, "passed");
    await assert.rejects(f.controller.codeFeature(f.delivery.id), /baseline/);
    f.validation.execute = execute;
    const second = await f.controller.validateBaseline(f.delivery.id);
    assert.notEqual(second.validation.attempts[1].outcome, "passed");
    assert.equal(
      second.validation.attempts[0].results.find((r) => r.checkId === "lint")
        .status,
      status,
    );
    await assert.rejects(
      f.controller.validateBaseline(f.delivery.id),
      /diagnostic/,
    );
  });

test("only externally declared exception and flake policy permit incomplete results or a passing diagnostic", async (t) => {
  const f = validationFixture(t, (p) => {
    p.validationContract.checks.find((c) => c.id === "format").exception = {
      statuses: ["skipped"],
      reason: "Documented owner exception for generated formatting",
    };
    p.validationContract.checks.find((c) => c.id === "lint").flake = {
      allowDiagnosticPass: true,
      reason: "Owner-approved tracked lint service flake",
    };
  });
  const execute = f.validation.execute.bind(f.validation);
  let failed = true;
  f.validation.execute = async (r) => ({
    ...(await execute(r)),
    status:
      r.check.id === "format"
        ? "skipped"
        : r.check.id === "lint" && failed
          ? "failure"
          : "success",
  });
  await f.controller.planFeature(f.delivery.id);
  assert.equal(
    (await f.controller.validateBaseline(f.delivery.id)).validation.attempts[0]
      .outcome,
    "failed",
  );
  failed = false;
  const result = await f.controller.validateBaseline(f.delivery.id);
  assert.equal(result.validation.attempts[1].outcome, "passed");
  assert.equal(result.validation.attempts[0].outcome, "failed");
});

test("a hung isolated check times out, blocks overlap until descendant recovery, and retains the failed attempt", async (t) => {
  const f = validationFixture(t, (p) => {
    p.validationContract.checks[0].timeoutMs = 10;
  });
  await f.controller.planFeature(f.delivery.id);
  const execute = f.validation.execute.bind(f.validation),
    stop = f.validation.stop.bind(f.validation);
  f.validation.execute = () => new Promise(() => {});
  f.validation.stop = async (r) => ({
    ...(await stop(r)),
    stopped: false,
    remainingProcesses: 1,
  });
  let deadline;
  const outcome = await Promise.race([
    f.controller.validateBaseline(f.delivery.id),
    new Promise((resolve) => {
      deadline = setTimeout(() => resolve("hung"), 5000);
    }),
  ]);
  clearTimeout(deadline);
  assert.notEqual(outcome, "hung");
  assert.equal(outcome.validation.attempts[0].outcome, "timeout");
  assert.equal(outcome.validation.attempts[0].state, "uncertain");
  await assert.rejects(f.controller.validateBaseline(f.delivery.id), /stopped/);
  assert.throws(
    () => f.controller.release(f.delivery.id),
    /Validation|validation/,
  );
  assert.throws(
    () => f.controller.resume(f.delivery.id),
    /Validation|validation/,
  );
  f.validation.stop = stop;
  f.validation.execute = execute;
  const reopened = new DeliveryController(f.state, f.options, {
    validationRuntime: f.validation,
  });
  const recovered = await reopened.recover(f.delivery.id);
  assert.equal(recovered.validation.attempts[0].state, "stopped");
  assert.equal(recovered.validation.attempts[0].outcome, "timeout");
  const rerun = await f.controller.validateBaseline(f.delivery.id);
  assert.notEqual(rerun.validation.attempts[1].outcome, "passed");
});

for (const drift of ["policy", "environment", "source", "candidate"])
  test(`validation ${drift} drift cannot produce current passing evidence`, async (t) => {
    const f = validationFixture(t);
    await f.controller.planFeature(f.delivery.id);
    if (drift === "candidate") {
      await f.controller.validateBaseline(f.delivery.id);
      await f.controller.codeFeature(f.delivery.id);
    }
    const stop = f.validation.stop.bind(f.validation);
    f.validation.stop = async (r) => {
      const result = await stop(r);
      if (drift === "policy") writeFileSync(f.options.policyPath, "{}");
      if (drift === "environment")
        f.policy.validationContract.environment.imageSha256 = "f".repeat(64);
      if (drift === "source")
        writeFileSync(
          f.repository + "/index.html",
          "changed by another process",
        );
      if (drift === "candidate")
        writeFileSync(
          f.controller.status(f.delivery.id).feature.candidate.path,
          "[]",
        );
      return result;
    };
    const result = await f.controller[
      drift === "candidate" ? "validateCandidate" : "validateBaseline"
    ](f.delivery.id);
    assert.equal(result.validation.attempts.at(-1).outcome, "stale");
    if (drift === "candidate")
      assert.equal(result.feature.candidate.validation, "not-run");
  });

test("feature E2E requirements cannot silently fall back to a worker without synthetic infrastructure", async (t) => {
  const f = validationFixture(t);
  f.criteria.plan = async () => ({
    criteria: ["Saved form survives reload"],
    verification: ["Browser submits to disposable database"],
    ambiguity: null,
    requires: ["browser", "database"],
  });
  await f.controller.planFeature(f.delivery.id);
  await assert.rejects(
    f.controller.validateBaseline(f.delivery.id),
    /infrastructure|E2E/,
  );
  assert.equal(f.controller.status(f.delivery.id).validation, undefined);
});

test("owner policy must declare PR and main checks with trusted publishers", async (t) => {
  const f = validationFixture(t, (p) => {
    p.validationContract.checks = p.validationContract.checks.filter(
      (c) => c.scope === "local",
    );
  });
  await f.controller.planFeature(f.delivery.id);
  await assert.rejects(
    f.controller.validateBaseline(f.delivery.id),
    /hosted|PR|main/,
  );
});

test("CLI validation commands reach the controlled-adapter gate without accepting repository executors", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  for (const command of ["validate-baseline", "validate-candidate"]) {
    const result = spawnSync(
      process.execPath,
      ["dist/cli.js", command, "--id", f.delivery.id, "--state-dir", f.state],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(
      JSON.parse(result.stderr || result.stdout).error,
      /controlled isolated runtime/,
    );
  }
});

test("an unchanged tree on a new main revision still needs a fresh baseline", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  f.git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "New main revision",
  );
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /baseline/);
  assert.equal(f.runtime.request, undefined);
});

test("changed validation environment cannot reuse an earlier baseline to start coding", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  f.policy.validationContract.environment.imageSha256 = "f".repeat(64);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /baseline|environment/,
  );
  assert.equal(f.runtime.request, undefined);
});

for (const control of ["pause", "cancel"])
  test(`validation ${control} fences late success and stops descendants before acknowledging`, async (t) => {
    const f = validationFixture(t);
    await f.controller.planFeature(f.delivery.id);
    const execute = f.validation.execute.bind(f.validation);
    let acknowledgement;
    f.validation.execute = async (r) => {
      const result = await execute(r);
      acknowledgement = await f.controller[control](f.delivery.id);
      return result;
    };
    const result = await f.controller.validateBaseline(f.delivery.id);
    assert.equal(acknowledgement.validation.attempts[0].state, "stopped");
    assert.equal(result.phase, control === "pause" ? "paused" : "cancelled");
    assert.notEqual(result.validation.attempts[0].outcome, "passed");
  });

test("formatting output changes invalidate the exact candidate even when all check results claim success", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  await f.controller.codeFeature(f.delivery.id);
  const stop = f.validation.stop.bind(f.validation);
  f.validation.stop = async (r) => ({
    ...(await stop(r)),
    treeSha256: "f".repeat(64),
  });
  const result = await f.controller.validateCandidate(f.delivery.id);
  assert.equal(result.feature.candidate.validation, "not-run");
  assert.notEqual(result.validation.attempts.at(-1).outcome, "passed");
});

for (const alteration of [
  "publisher",
  "revision",
  "environment",
  "missing",
  "artifact",
])
  test(`untrusted ${alteration} results remain incomplete after verified shutdown`, async (t) => {
    const f = validationFixture(t);
    await f.controller.planFeature(f.delivery.id);
    const execute = f.validation.execute.bind(f.validation);
    f.validation.execute = async (r) => {
      const result = await execute(r);
      if (alteration === "publisher") result.publisher = "candidate-chosen";
      if (alteration === "revision") result.treeSha256 = "f".repeat(64);
      if (alteration === "environment")
        result.environmentSha256 = "f".repeat(64);
      if (alteration === "artifact")
        result.artifacts = [{ name: "log", sha256: "invalid" }];
      return alteration === "missing" ? undefined : result;
    };
    const result = await f.controller.validateBaseline(f.delivery.id);
    assert.equal(result.validation.attempts[0].outcome, "incomplete");
    assert.equal(result.validation.attempts[0].state, "stopped");
  });

test("candidate package-script additions are refused before validation dispatch", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  const marker = f.root + "/host-script-ran";
  const bytes = Buffer.from(
    JSON.stringify({
      scripts: {
        postinstall: `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)},"ran")'`,
        lint: "exit 0",
      },
      validationContract: { checks: [] },
    }),
  );
  const hash = createHash("sha256").update(bytes).digest("hex"),
    collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (r) => {
    const output = await collect(r);
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
  await f.controller.codeFeature(f.delivery.id);
  const execute = f.validation.execute.bind(f.validation);
  let packageSeen = false;
  f.validation.execute = async (r) => {
    packageSeen ||= r.files.some(
      (f) => f.path === "package.json" && f.bytes.equals(bytes),
    );
    assert.deepEqual(r.check.command, ["npm", "run", r.check.kind]);
    return execute(r);
  };
  await assert.rejects(
    f.controller.validateCandidate(f.delivery.id),
    /protected validation inputs/,
  );
  assert.equal(packageSeen, false);
  assert.equal(existsSync(marker), false);
});

test("declared browser/database acceptance uses matching synthetic infrastructure", async (t) => {
  const f = validationFixture(t, (p) => {
    p.validationContract.environment.browser = true;
    p.validationContract.environment.database = true;
    p.validationContract.checks.push({
      id: "local-e2e",
      kind: "e2e",
      scope: "local",
      stages: ["baseline", "candidate"],
      command: ["npm", "run", "test:e2e"],
      publisher: "isolated-checker",
      timeoutMs: 1000,
    });
  });
  f.criteria.plan = async () => ({
    criteria: ["Saved form survives reload"],
    verification: ["Browser checks the disposable database"],
    ambiguity: null,
    requires: ["browser", "database"],
  });
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  await f.controller.codeFeature(f.delivery.id);
  const result = await f.controller.validateCandidate(f.delivery.id),
    attempt = result.validation.attempts.at(-1);
  assert.equal(attempt.outcome, "passed");
  assert.equal(attempt.contract.environment.synthetic, true);
  assert.equal(
    attempt.results.find((r) => r.checkId === "local-e2e").status,
    "success",
  );
});

test("main moving during environment inspection prevents coding dispatch", async (t) => {
  const f = validationFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  const inspect = f.validation.inspect.bind(f.validation);
  f.validation.inspect = async () => {
    const result = spawnSync(
      "git",
      [
        "-C",
        f.repository,
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/nonexistent",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "advance main",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return inspect();
  };
  let dispatched = false;
  f.runtime.execute = async () => {
    dispatched = true;
    throw Error("unexpected");
  };
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /main changed/i,
  );
  assert.equal(dispatched, false);
});

for (const alteration of ["bytes", "deletion", "mode"]) {
  test(
    "protected validation input " + alteration + " is refused before execution",
    async (t) => {
      const f = validationFixture(t, (p) => {
        p.validationContract.mutablePaths = [];
      });
      await f.controller.planFeature(f.delivery.id);
      await f.controller.validateBaseline(f.delivery.id);
      const collect = f.runtime.collect.bind(f.runtime);
      f.runtime.collect = async (r) => {
        const output = await collect(r);
        if (alteration === "deletion")
          output.files[0].path = "replacement.html";
        if (alteration === "mode") {
          const file = output.files[0];
          file.bytes = readFileSync(f.repository + "/index.html");
          file.beforeSha256 = file.afterSha256 = createHash("sha256")
            .update(file.bytes)
            .digest("hex");
          file.executable = true;
        }
        return output;
      };
      await f.controller.codeFeature(f.delivery.id);
      let executed = false;
      f.validation.execute = async () => {
        executed = true;
        throw Error("unexpected");
      };
      await assert.rejects(
        f.controller.validateCandidate(f.delivery.id),
        /protected validation inputs/,
      );
      assert.equal(executed, false);
    },
  );
}
