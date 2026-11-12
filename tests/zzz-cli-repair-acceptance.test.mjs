import "./helpers/owner-host-stand-in.mjs";
// #266: the owner-run CLI acceptance with --with-repair, its VM steps
// simulated. The name sorts after every other test file but the docs ones.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { offlineValidationEnvironment } from "../dist/native-validation.js";
import {
  budgetDollars,
  cliDeliveryAcceptance,
  ownerInputs,
  privateRoot,
  repairCheckId,
  repairHook,
  repairPassingOutcome,
  repairStageNames,
} from "../scripts/run-native-cli-delivery-acceptance.mjs";

const imageSha256 = "a".repeat(64);
const codingPins = {
  cliVersion: "2.1.311",
  cliSha256: "1".repeat(64),
  policySha256: "3".repeat(64),
  bindingSha256: "4".repeat(64),
};
const validationPins = {
  imageSha256,
  policySha256: "5".repeat(64),
  bindingSha256: "6".repeat(64),
};
const option = (args, name) => args[args.indexOf(name) + 1];
const route = (id) => ({
  deliveryId: id,
  decisionSha256: createHash("sha256")
    .update("aios-spend-budget-route-v1:" + id)
    .digest("hex"),
});
const session = (id) => ({
  operationId: randomUUID(),
  fence: 1,
  intent: "start",
  state: "stopped",
  provider: "claude",
  threadStarted: true,
  threadId: randomUUID(),
  route: route(id),
});
const host = (cleaned = []) => ({
  pins: {
    coding: { admitted: codingPins, fresh: async () => codingPins },
    validation: { admitted: validationPins, fresh: async () => validationPins },
  },
  machine: "aios-test",
  codingAdmission: "/owner/coding-admission.json",
  validationAdmission: "/owner/validation-admission.json",
  authDirectory: "/owner/auth",
  imageSha256,
  cleanupCodingSession: async (s) => {
    cleaned.push(s.operationId);
    return { cleaned: 1 };
  },
  repair: true,
});

/** A CLI whose VM steps are simulated, with a candidate that fails only the
 * hook check until one repair; `faults` changes what they report. */
function simulatedCli(faults = {}) {
  const calls = [];
  let d, repository;
  const ok = (value) => ({
    status: 0,
    stdout: JSON.stringify(value),
    stderr: "",
  });
  const results = (marker) => [
    { checkId: "format", status: "success" },
    { checkId: "acceptance", status: "success" },
    { checkId: repairCheckId, status: marker },
  ];
  const commands = {
    start(args) {
      repository = option(args, "--repo");
      d = {
        id: randomUUID(),
        phase: "blocked",
        onboarding: { ready: true, attestation: { source: "owner-attested" } },
        blocker: { code: "DELIVERY_NOT_ENABLED" },
        initialRepairAllowance: {
          cycles: Number(option(args, "--repair-cycles")),
          ms: 3600000,
        },
      };
      return ok(d);
    },
    "plan-feature"(args) {
      const criteria = JSON.parse(
        readFileSync(option(args, "--feature-criteria"), "utf8"),
      );
      d.feature = { outcome: "planned", criteria: criteria.criteria };
      return ok(d);
    },
    "validate-baseline"() {
      d.validation = {
        attempts: [
          {
            stage: "baseline",
            state: "stopped",
            outcome: "passed",
            bindingSha256: "b".repeat(64),
            results: [{ checkId: "format", status: "success" }],
          },
        ],
      };
      return ok(d);
    },
    "code-feature"() {
      const branch = `aios/feature-${d.id}`;
      spawnSync("git", ["-C", repository, "branch", branch, "main"]);
      Object.assign(d.feature, {
        outcome: "admitted",
        branch,
        candidate: { sha256: "c".repeat(64), validation: "not-run" },
        session: session(d.id),
      });
      d.spend = {
        model: "claude-opus-5-5",
        budget: budgetDollars * 1e12,
        spent: 72000000,
        charges: 3,
        extensions: [],
      };
      return ok(d);
    },
    "validate-candidate"() {
      d.validation.attempts.push({
        stage: "candidate",
        state: "stopped",
        outcome: faults.candidate ?? "failed",
        results: faults.candidateResults ?? results("failure"),
      });
      d.feature.candidate.validation = faults.candidate ?? "failed";
      return ok(d);
    },
    "repair-feature"(args) {
      d.repair ??= {
        allowanceCycles: d.initialRepairAllowance.cycles,
        allowanceMs: d.initialRepairAllowance.ms,
        activeMs: 0,
        attempts: [],
        extensions: [],
      };
      const r = d.repair;
      if (r.attempts.length >= r.allowanceCycles && !faults.notExhausted) {
        d.blocker = {
          ...d.blocker,
          nextAction:
            "Repair allowance exhausted; record an explicit owner extension.",
        };
        return ok(d);
      }
      assert.equal(option(args, "--auth-directory"), "/owner/auth");
      r.activeMs += faults.activeMs ?? 42000;
      r.attempts.push({
        id: randomUUID(),
        state: "stopped",
        outcome: faults.repairOutcome ?? "passed",
        findings: faults.findings ?? [
          "Candidate validation: failed",
          "Candidate check " + repairCheckId + ": failure",
        ],
        remainingCycles: r.allowanceCycles - r.attempts.length - 1,
        remainingMs: r.allowanceMs - r.activeMs,
        codingSession: { ...session(d.id), ...faults.repairSession },
      });
      d.spend = {
        ...d.spend,
        spent: d.spend.spent + (faults.repairSpent ?? 50000000),
        charges: d.spend.charges + 2,
      };
      const passed = (faults.repairOutcome ?? "passed") === "passed";
      d.validation.attempts.push({
        stage: "candidate",
        state: "stopped",
        outcome: passed ? "passed" : "failed",
        results: results(passed ? "success" : "failure"),
      });
      d.feature.candidate.validation = passed ? "passed" : "failed";
      return ok(d);
    },
    "extend-repair"(args) {
      const cycles = Number(option(args, "--cycles"));
      d.repair.allowanceCycles += faults.ignoreExtension ? 0 : cycles;
      if (!faults.ignoreExtension)
        d.repair.extensions.push({ addedCycles: cycles, addedMs: 0, at: "t" });
      return ok(d);
    },
    status() {
      return ok(d);
    },
    cancel() {
      return ok(d);
    },
  };
  const cli = async (args) => {
    calls.push(args);
    return commands[args[0]](args);
  };
  return { cli, calls };
}

test("the repair acceptance repairs a candidate that failed only the hook check, then is refused as exhausted until an owner extension", async () => {
  const cleaned = [];
  const { cli, calls } = simulatedCli();
  const report = await cliDeliveryAcceptance({ cli, ...host(cleaned) });
  assert.equal(report.outcome, repairPassingOutcome, report.error);
  assert.equal(report.scope, "native-cli-metered-repair-acceptance");
  assert.deepEqual(
    report.stages.map((s) => [s.name, s.outcome]),
    repairStageNames.map((name) => [name, "passed"]),
  );
  assert.deepEqual(
    calls.map((args) => args[0]),
    [
      "start",
      "plan-feature",
      "validate-baseline",
      "code-feature",
      "validate-candidate",
      "repair-feature",
      "repair-feature",
      "extend-repair",
      "status",
    ],
  );
  const byCommand = Object.fromEntries(calls.map((args) => [args[0], args]));
  assert.equal(option(byCommand.start, "--repair-cycles"), "1");
  assert.equal(option(byCommand["extend-repair"], "--cycles"), "1");
  const repair = calls.find((args) => args[0] === "repair-feature");
  for (const [flag, value] of [
    ["--podman-machine", "aios-test"],
    ["--coding-admission", "/owner/coding-admission.json"],
    ["--validation-admission", "/owner/validation-admission.json"],
    ["--auth-directory", "/owner/auth"],
  ])
    assert.equal(option(repair, flag), value);
  assert.ok(!repair.includes("--coding-minutes"));
  assert.equal(report.repair.allowanceCycles, 1);
  assert.equal(report.repair.attempts, 1);
  assert.equal(report.repair.outcome, "passed");
  assert.equal(report.repair.remainingCycles, 0);
  assert.equal(report.repair.activeMs, 42000);
  assert.equal(report.repair.revalidation.outcome, "passed");
  assert.deepEqual(report.repairSpend, {
    spent: 122000000,
    charges: 5,
    interrupted: false,
  });
  assert.match(report.exhausted, /Repair allowance exhausted/);
  // Both turns' sessions are cleaned up.
  assert.equal(cleaned.length, 2);
  assert.notEqual(cleaned[0], cleaned[1]);
});

test("the repair acceptance blocks when the candidate fails otherwise, the repair is not as observed, or exhaustion and extension are not recorded", async () => {
  for (const [faults, blocked, error] of [
    [{ candidate: "passed" }, "cli-validate-candidate", /did not fail exactly/],
    [
      {
        candidateResults: [
          { checkId: "format", status: "failure" },
          { checkId: repairCheckId, status: "failure" },
        ],
      },
      "cli-validate-candidate",
      /did not fail exactly/,
    ],
    [
      { repairOutcome: "failed" },
      "cli-repair-feature",
      /did not pass revalidation/,
    ],
    [
      { findings: ["Candidate validation: failed"] },
      "cli-repair-feature",
      /not given the failed check/,
    ],
    [{ activeMs: 0 }, "cli-repair-feature", /active time/],
    [
      { repairSession: { provider: "codex" } },
      "cli-repair-feature",
      /Claude Code session/,
    ],
    [
      { repairSession: { route: route("other") } },
      "cli-repair-feature",
      /Claude Code session/,
    ],
    [{ repairSpent: 0 }, "cli-repair-feature", /charged within the budget/],
    [{ repairSpent: 6e12 }, "cli-repair-feature", /charged within the budget/],
    [
      { notExhausted: true },
      "cli-repair-exhausted",
      /not reported as exhausted/,
    ],
    [
      { ignoreExtension: true },
      "cli-extend-repair",
      /extension was not recorded/,
    ],
  ]) {
    const { cli } = simulatedCli(faults);
    const report = await cliDeliveryAcceptance({ cli, ...host() });
    assert.equal(report.outcome, "blocked", JSON.stringify(faults));
    assert.equal(
      report.stages.find((s) => s.outcome === "blocked")?.name,
      blocked,
      JSON.stringify(faults),
    );
    assert.match(report.error, error);
  }
});

test("with repair, the owner contract adds a candidate-only check for the test hook", async (t) => {
  const root = await privateRoot("aios-cli-repair-owner-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inputs = ownerInputs(root, offlineValidationEnvironment(imageSha256), {
    repair: true,
  });
  const policy = JSON.parse(readFileSync(inputs.policyPath, "utf8"));
  const added = policy.validationContract.checks.find(
    (c) => c.id === repairCheckId,
  );
  assert.deepEqual(added, {
    id: repairCheckId,
    kind: "acceptance",
    scope: "local",
    stages: ["candidate"],
    command: [
      "grep",
      "-qE",
      "data-testid=[\"']contact-hint[\"']",
      "index.html",
    ],
    publisher: "isolated-checker",
    timeoutMs: 60000,
  });
  // The base page, the baseline's, has no hook; the hook the repair adds
  // satisfies the check's pattern, in either quote style.
  assert.ok(
    !readFileSync(`${inputs.repository}/index.html`, "utf8").includes(
      "data-testid",
    ),
  );
  const pattern = new RegExp(added.command[2]);
  assert.match(`<p ${repairHook}>Hint</p>`, pattern);
  assert.match(`<p data-testid='contact-hint'>Hint</p>`, pattern);
  assert.doesNotMatch(`<p data-testid="other">Hint</p>`, pattern);
  const plain = ownerInputs(
    await privateRoot("aios-cli-plain-owner-"),
    offlineValidationEnvironment(imageSha256),
  );
  assert.ok(
    !JSON.parse(
      readFileSync(plain.policyPath, "utf8"),
    ).validationContract.checks.some((c) => c.id === repairCheckId),
  );
});
