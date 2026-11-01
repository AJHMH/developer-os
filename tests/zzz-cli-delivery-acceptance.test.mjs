// ADR 0004 slice 6: the owner-run CLI delivery acceptance, with its VM steps
// simulated. The name sorts after every other test file, so no other file
// changes shard.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { offlineValidationEnvironment } from "../dist/native-validation.js";
import {
  cliDeliveryAcceptance,
  cliRunner,
  codingMinutes,
  ownerInputs,
  passingOutcome,
  privateRoot,
  request,
  stageNames,
} from "../scripts/run-native-cli-delivery-acceptance.mjs";

const imageSha256 = "a".repeat(64);
const codingPins = {
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
  codeModeHostSha256: "2".repeat(64),
  policySha256: "3".repeat(64),
  bindingSha256: "4".repeat(64),
};
const validationPins = {
  imageSha256,
  policySha256: "5".repeat(64),
  bindingSha256: "6".repeat(64),
};
/** The VM's fresh pins and the owner's records; `changes` alters the fresh. */
const pins = (changes = {}) => ({
  coding: {
    admitted: codingPins,
    fresh: async () => ({ ...codingPins, ...changes.coding }),
  },
  validation: {
    admitted: validationPins,
    fresh: async () => ({ ...validationPins, ...changes.validation }),
  },
});
const host = {
  pins: pins(),
  machine: "aios-test",
  codingAdmission: "/owner/coding-admission.json",
  validationAdmission: "/owner/validation-admission.json",
  codex: "/owner/codex",
  imageSha256,
};
const option = (args, name) => args[args.indexOf(name) + 1];

test("the synthetic owner inputs start and plan a delivery through the real CLI", async (t) => {
  const root = await privateRoot("aios-cli-owner-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inputs = ownerInputs(root, offlineValidationEnvironment(imageSha256));
  const cli = cliRunner(join(root, "state"));
  const run = async (...args) => {
    const result = await cli(args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const owner = [
    "--owner-policy",
    inputs.policyPath,
    "--onboarding-attestation",
    inputs.attestationPath,
  ];
  const started = await run(
    "start",
    "--repo",
    inputs.repository,
    "--request",
    request,
    ...owner,
  );
  // Ready from the local hints and the attestation alone.
  assert.equal(started.onboarding.ready, true);
  assert.equal(started.onboarding.attestation.source, "owner-attested");
  const planned = await run(
    "plan-feature",
    "--id",
    started.id,
    "--feature-criteria",
    inputs.criteria(started.id),
  );
  assert.equal(planned.feature.outcome, "planned");
  assert.deepEqual(planned.feature.criteria, [
    "The contact page shows a visible hint.",
  ]);
  // Without the validation admission the CLI has no runtime to validate on.
  const refused = await cli([
    "validate-baseline",
    "--id",
    started.id,
    ...owner,
  ]);
  assert.equal(refused.status, 1);
});

test(
  "a Windows temp folder that grants others access by inheritance is made private before the owner records are written",
  { skip: process.platform !== "win32" && "Windows ACL inheritance" },
  async (t) => {
    // A parent like the owner's TEMP: another account may modify anything
    // created inside it, by inheritance.
    const parent = realpathSync(
      mkdtempSync(join(tmpdir(), "aios-cli-shared-")),
    );
    t.after(() => rmSync(parent, { recursive: true, force: true }));
    const grant = spawnSync(
      join(process.env.SystemRoot, "System32", "icacls.exe"),
      [parent, "/grant", "*S-1-5-32-545:(OI)(CI)(M)"],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(grant.status, 0, grant.stderr);
    const ready = async (root) => {
      const inputs = ownerInputs(
        root,
        offlineValidationEnvironment(imageSha256),
      );
      const result = await cliRunner(join(root, "state"))([
        "start",
        "--repo",
        inputs.repository,
        "--request",
        request,
        "--owner-policy",
        inputs.policyPath,
        "--onboarding-attestation",
        inputs.attestationPath,
      ]);
      // A refused record either fails `start` or leaves onboarding unready.
      return result.status === 0 && JSON.parse(result.stdout).onboarding.ready;
    };
    // Without the lockdown the CLI refuses the records, as on the owner's host.
    assert.equal(
      await ready(realpathSync(mkdtempSync(join(parent, "inherited-")))),
      false,
    );
    assert.equal(await ready(await privateRoot("private-", parent)), true);
  },
);

/** A CLI whose VM steps are simulated; `faults` changes what they report. */
function simulatedCli(faults = {}) {
  const calls = [];
  let delivery, repository;
  const ok = (value) => ({
    status: 0,
    stdout: JSON.stringify(value),
    stderr: "",
  });
  const refuse = (error) => ({
    status: 1,
    stdout: "",
    stderr: JSON.stringify({ error }),
  });
  const commands = {
    start(args) {
      repository = option(args, "--repo");
      delivery = {
        id: randomUUID(),
        phase: "blocked",
        onboarding: { ready: true, attestation: { source: "owner-attested" } },
        blocker: { code: "DELIVERY_NOT_ENABLED" },
      };
      return ok(delivery);
    },
    "plan-feature"(args) {
      const criteria = JSON.parse(
        readFileSync(option(args, "--feature-criteria"), "utf8"),
      );
      assert.equal(criteria.deliveryId, delivery.id);
      assert.equal(criteria.request, request);
      delivery.feature = { outcome: "planned", criteria: criteria.criteria };
      return ok(delivery);
    },
    "validate-baseline"() {
      delivery.validation = {
        attempts: [
          {
            stage: "baseline",
            state: "stopped",
            outcome: faults.baseline ?? "passed",
            bindingSha256: "b".repeat(64),
            results: [{ checkId: "format", status: "success" }],
          },
        ],
      };
      return ok(delivery);
    },
    "code-feature"() {
      const branch = `codex/feature-${delivery.id}`;
      spawnSync("git", ["-C", repository, "branch", branch, "main"]);
      Object.assign(delivery.feature, {
        outcome: "failed",
        branch,
        session: {
          state: "stopped",
          threadStarted: true,
          threadId: randomUUID(),
        },
        ...faults.feature,
      });
      return ok(delivery);
    },
    "validate-candidate"() {
      return faults.candidateValidates
        ? ok(delivery)
        : refuse("Validation requires an admitted candidate.");
    },
    status() {
      return ok(delivery);
    },
    cancel() {
      if (!faults.cancelUncertain) delivery.feature.session.state = "stopped";
      return ok(delivery);
    },
  };
  const cli = async (args) => {
    calls.push(args);
    return commands[args[0]](args);
  };
  return { cli, calls };
}

test("the CLI acceptance passes on an offline turn that stops exactly, with each step given only its owner inputs", async () => {
  const { cli, calls } = simulatedCli();
  const report = await cliDeliveryAcceptance({ cli, ...host });
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.deepEqual(
    report.stages.map((s) => [s.name, s.outcome]),
    stageNames.map((name) => [name, "passed"]),
  );
  assert.equal(report.productionEnabled, false);
  assert.equal(report.inferenceAuthorized, false);
  assert.deepEqual(report.coding, {
    outcome: "failed",
    state: "stopped",
    threadStarted: true,
    routed: false,
    candidate: false,
    branch: `codex/feature-${report.deliveryId}`,
    blocker: "DELIVERY_NOT_ENABLED",
  });
  assert.match(report.candidateRefusal, /admitted candidate/);
  const byCommand = Object.fromEntries(calls.map((args) => [args[0], args]));
  assert.deepEqual(
    calls.map((args) => args[0]),
    [
      "start",
      "plan-feature",
      "validate-baseline",
      "code-feature",
      "validate-candidate",
      "status",
      "status",
    ],
  );
  const coding = byCommand["code-feature"];
  assert.equal(option(coding, "--podman-machine"), host.machine);
  assert.equal(option(coding, "--coding-admission"), host.codingAdmission);
  assert.equal(
    option(coding, "--validation-admission"),
    host.validationAdmission,
  );
  assert.equal(option(coding, "--codex-executable"), host.codex);
  assert.equal(option(coding, "--coding-minutes"), String(codingMinutes));
  assert.ok(coding.includes("--owner-policy"));
  assert.ok(coding.includes("--onboarding-attestation"));
  // Offline: the turn is never given the owner's account.
  assert.ok(!calls.flat().some((arg) => arg.startsWith("--auth-")));
  assert.ok(!byCommand["validate-baseline"].includes("--coding-admission"));
  assert.ok(!byCommand["start"].includes("--podman-machine"));
});

test("the CLI acceptance blocks on a failed baseline, an admitted or routed offline turn, or a candidate validated without one", async () => {
  for (const [faults, blocked] of [
    [{ baseline: "failed" }, "cli-validate-baseline"],
    [
      { feature: { outcome: "admitted", candidate: { path: "/x" } } },
      "cli-code-feature",
    ],
    [
      {
        feature: {
          session: {
            state: "stopped",
            threadStarted: true,
            threadId: randomUUID(),
            route: { deliveryId: "d", decisionSha256: "e".repeat(64) },
          },
        },
      },
      "cli-code-feature",
    ],
    [
      { feature: { session: { state: "stopped", threadStarted: false } } },
      "cli-code-feature",
    ],
    [{ candidateValidates: true }, "cli-candidate-refused"],
  ]) {
    const { cli } = simulatedCli(faults);
    const report = await cliDeliveryAcceptance({ cli, ...host });
    assert.equal(report.outcome, "blocked");
    assert.equal(
      report.stages.find((s) => s.outcome === "blocked")?.name,
      blocked,
    );
  }
});

test("an open coding session is stopped exactly at the end, and an unverified stop leaves the run uncertain", async () => {
  const running = () => ({
    feature: { session: { state: "uncertain", threadStarted: true } },
  });
  const stopped = simulatedCli(running());
  const report = await cliDeliveryAcceptance({ cli: stopped.cli, ...host });
  assert.equal(report.outcome, "blocked");
  const cancel = stopped.calls.find((args) => args[0] === "cancel");
  assert.equal(option(cancel, "--coding-admission"), host.codingAdmission);
  assert.equal(
    option(cancel, "--validation-admission"),
    host.validationAdmission,
  );
  assert.equal(report.stages.at(-1).name, "final-exact-stop");
  assert.equal(report.stages.at(-1).outcome, "passed");
  const uncertain = simulatedCli({ ...running(), cancelUncertain: true });
  assert.equal(
    (await cliDeliveryAcceptance({ cli: uncertain.cli, ...host })).outcome,
    "uncertain",
  );
});

test("a record that does not name the VM's fresh pins stops the run before any CLI step, and reports the fresh pins", async () => {
  for (const [changes, record] of [
    [{ coding: { policySha256: "9".repeat(64) } }, /coding admission/],
    [{ validation: { bindingSha256: "9".repeat(64) } }, /validation admission/],
  ]) {
    const { cli, calls } = simulatedCli();
    const report = await cliDeliveryAcceptance({
      cli,
      ...host,
      pins: pins(changes),
    });
    assert.equal(report.outcome, "blocked");
    assert.equal(report.stages.length, 1);
    assert.equal(report.stages[0].name, "owner-records-name-fresh-pins");
    assert.match(report.error, record);
    assert.deepEqual(calls, [], "no CLI step ran");
    assert.deepEqual(report.freshPins, {
      coding: { ...codingPins, ...changes.coding },
      validation: { ...validationPins, ...changes.validation },
    });
  }
});
