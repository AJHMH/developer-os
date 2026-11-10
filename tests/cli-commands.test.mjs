import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cliCommands,
  cliOptions,
  validateCliCommand,
} from "../dist/cli-commands.js";
const sample = (key) =>
  ({
    "auth-account": "a".repeat(64),
    "podman-machine": "aios-test",
    minutes: "1",
    cycles: "1",
    "coding-minutes": "1",
    dollars: "5",
    "budget-dollars": "5",
    turns: "1",
    adversarial: true,
  })[key] ?? "fixture";
for (const [name, command] of Object.entries(cliCommands)) {
  test(`${name} validates its required and forbidden options from the command contract`, () => {
    const values = Object.fromEntries(
      command.required.map((key) => [key, sample(key)]),
    );
    if (name === "extend-repair") values.minutes = "1";
    const names = Object.keys(values);
    assert.equal(validateCliCommand([name], values, names).name, name);
    for (const key of command.required) {
      const missing = { ...values };
      delete missing[key];
      assert.equal(
        validateCliCommand(
          [name],
          missing,
          names.filter((n) => n !== key),
        ).error,
        "arguments",
      );
    }
    for (const key of Object.keys(cliOptions).filter(
      (key) =>
        !["state-dir", ...command.required, ...command.optional].includes(key),
    )) {
      assert.equal(
        validateCliCommand([name], { ...values, [key]: sample(key) }, [
          ...names,
          key,
        ]).error,
        "arguments",
      );
    }
    assert.equal(
      validateCliCommand([name, "extra"], values, names).error,
      "arguments",
    );
    assert.equal(
      validateCliCommand([name], values, [...names, "state-dir", "state-dir"])
        .error,
      "arguments",
    );
  });
}
test("a PR rerun dispatches the independently required check identifier", async () => {
  const calls = [];
  const controller = {
    rerunPRCheck: (...args) => calls.push(["rerun", ...args]),
  };
  const values = { id: "delivery", "check-id": "check" };
  const invocation = validateCliCommand(
    ["rerun-pr-check"],
    values,
    Object.keys(values),
  );
  assert.equal(invocation.name, "rerun-pr-check");
  await invocation.command.invoke(controller, values);
  assert.deepEqual(calls, [["rerun", "delivery", "check"]]);
});
test("native prerequisites and numeric extensions remain bounded", () => {
  for (const values of [
    { id: "d", "podman-machine": "other" },
    { id: "d", "podman-machine": "" },
  ]) {
    assert.equal(
      validateCliCommand(["recover"], values, Object.keys(values)).error,
      "arguments",
    );
  }
  for (const minutes of ["-1", "0", "1441", "1.5", "NaN"])
    assert.equal(
      validateCliCommand(["extend-coding"], { id: "d", minutes }, [
        "id",
        "minutes",
      ]).error,
      "arguments",
    );
  assert.equal(
    validateCliCommand(["extend-repair"], { id: "d" }, ["id"]).error,
    "arguments",
  );
});

test("an owner coding admission is accepted only with a native machine on pause, cancel and recover", () => {
  for (const name of ["pause", "cancel", "recover"]) {
    const values = {
      id: "d",
      "podman-machine": "aios-test",
      "coding-admission": "/owner/coding-admission.json",
    };
    assert.equal(
      validateCliCommand([name], values, Object.keys(values)).name,
      name,
    );
    for (const refused of [
      { id: "d", "coding-admission": "/owner/coding-admission.json" },
      { id: "d", "podman-machine": "aios-test", "coding-admission": "" },
    ])
      assert.equal(
        validateCliCommand([name], refused, Object.keys(refused)).error,
        "arguments",
      );
  }
});

for (const command of ["pause", "repair-feature"])
  test(`${command} with a missing owner coding admission refuses before any delivery or VM effect`, (t) => {
    const state = mkdtempSync(join(tmpdir(), "aios-cli-coding-admission-"));
    t.after(() => rmSync(state, { recursive: true, force: true }));
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
        command,
        "--id",
        "11111111-2222-4333-8444-555555555555",
        "--state-dir",
        state,
        "--podman-machine",
        "aios-test",
        "--coding-admission",
        join(state, "missing-coding-admission.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(
      JSON.parse(result.stderr).error,
      /owner coding admission record is missing or invalid/,
    );
    assert.deepEqual(readdirSync(state), []);
  });

test("repair-feature with an invalid coding or validation record refuses before any delivery or VM effect", (t) => {
  const owner = mkdtempSync(join(tmpdir(), "aios-cli-repair-records-"));
  t.after(() => rmSync(owner, { recursive: true, force: true }));
  chmodSync(owner, 0o700);
  const coding = join(owner, "coding-admission.json"),
    invalid = join(owner, "invalid-admission.json");
  writeFileSync(
    coding,
    JSON.stringify({
      scope: "aios-claude-coding-admission-v1",
      approvedAt: "2026-10-21T12:00:00.000Z",
      pins: {
        cliSha256: "c".repeat(64),
        cliVersion: "2.1.311",
        policySha256: "d".repeat(64),
        bindingSha256: "e".repeat(64),
      },
    }),
    { mode: 0o600 },
  );
  writeFileSync(invalid, JSON.stringify({ scope: "unknown" }), { mode: 0o600 });
  const state = join(owner, "state");
  for (const [records, refusal] of [
    [
      ["--coding-admission", invalid],
      /owner coding admission record is missing or invalid/,
    ],
    [
      ["--coding-admission", coding, "--validation-admission", invalid],
      /owner validation admission record is missing or invalid/,
    ],
    [
      [
        "--coding-admission",
        coding,
        "--validation-admission",
        join(owner, "missing.json"),
      ],
      /owner validation admission record is missing or invalid/,
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
        "repair-feature",
        "--id",
        "11111111-2222-4333-8444-555555555555",
        "--state-dir",
        state,
        "--podman-machine",
        "aios-test",
        ...records,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error, refusal);
    assert.equal(readdirSync(owner).includes("state"), false);
  }
});

test("an owner validation admission is accepted only with a native machine on validation, pause, cancel and recover", () => {
  for (const name of [
    "validate-baseline",
    "validate-candidate",
    "pause",
    "cancel",
    "recover",
  ]) {
    const values = {
      id: "d",
      "podman-machine": "aios-test",
      "validation-admission": "/owner/validation-admission.json",
    };
    assert.equal(
      validateCliCommand([name], values, Object.keys(values)).name,
      name,
    );
    for (const refused of [
      { id: "d", "validation-admission": "/owner/validation-admission.json" },
      { id: "d", "podman-machine": "aios-test", "validation-admission": "" },
    ])
      assert.equal(
        validateCliCommand([name], refused, Object.keys(refused)).error,
        "arguments",
      );
  }
  const policy = {
    id: "d",
    "owner-policy": "/owner/policy.json",
    "podman-machine": "aios-test",
    "validation-admission": "/owner/validation-admission.json",
  };
  assert.equal(
    validateCliCommand(["validate-baseline"], policy, Object.keys(policy)).name,
    "validate-baseline",
  );
  const unrelated = {
    id: "d",
    "podman-machine": "aios-test",
    "validation-admission": "/owner/validation-admission.json",
  };
  assert.equal(
    validateCliCommand(["plan-feature"], unrelated, Object.keys(unrelated))
      .error,
    "arguments",
  );
});

test("a missing owner validation admission refuses before any delivery or VM effect", (t) => {
  const state = mkdtempSync(join(tmpdir(), "aios-cli-validation-admission-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  for (const command of ["validate-baseline", "pause"]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
        command,
        "--id",
        "11111111-2222-4333-8444-555555555555",
        "--state-dir",
        state,
        "--podman-machine",
        "aios-test",
        "--validation-admission",
        join(state, "missing-validation-admission.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, command);
    assert.match(
      JSON.parse(result.stderr).error,
      /owner validation admission record is missing or invalid/,
    );
    assert.deepEqual(readdirSync(state), []);
  }
});

test("a valid owner validation admission installs the native runtime without any VM effect", (t) => {
  const state = mkdtempSync(join(tmpdir(), "aios-cli-validation-runtime-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  chmodSync(state, 0o700);
  const record = join(state, "validation-admission.json");
  writeFileSync(
    record,
    JSON.stringify({
      scope: "aios-native-validation-admission-v1",
      approvedAt: "2026-10-22T12:00:00.000Z",
      pins: {
        imageSha256: "a".repeat(64),
        policySha256: "b".repeat(64),
        bindingSha256: "c".repeat(64),
      },
    }),
    { mode: 0o600 },
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      "validate-baseline",
      "--id",
      "11111111-2222-4333-8444-555555555555",
      "--state-dir",
      join(state, "state"),
      "--podman-machine",
      "aios-test",
      "--validation-admission",
      record,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  // The runtime was installed; only the unknown delivery refuses.
  assert.equal(JSON.parse(result.stderr).error, "Delivery not found.");
});

test("code-feature takes the owner's coding and validation inputs, auth directory and initial coding minutes", async () => {
  const values = {
    id: "d",
    "owner-policy": "/owner/policy.json",
    "onboarding-attestation": "/owner/onboarding-attestation.json",
    "podman-machine": "aios-test",
    "coding-admission": "/owner/claude-coding-admission.json",
    "validation-admission": "/owner/validation-admission.json",
    "auth-directory": "/owner/auth",
    "coding-minutes": "30",
  };
  const invocation = validateCliCommand(
    ["code-feature"],
    values,
    Object.keys(values),
  );
  assert.equal(invocation.name, "code-feature");
  const calls = [];
  const controller = { codeFeature: (...args) => calls.push(args) };
  await invocation.command.invoke(controller, values);
  await invocation.command.invoke(controller, { id: "d" });
  assert.deepEqual(calls, [
    ["d", { codingMinutes: 30 }],
    ["d", {}],
  ]);
  for (const refused of [
    { id: "d", "coding-admission": "/owner/claude-coding-admission.json" },
    { id: "d", "podman-machine": "aios-test", "coding-admission": "" },
    { id: "d", "coding-minutes": "0" },
    // A metered turn's auth directory needs the owner's coding record.
    { id: "d", "auth-directory": "/owner/auth" },
    // Codex's usage reader and fixed-worker options are no coding inputs.
    { ...values, "codex-executable": "/owner/codex" },
    { ...values, "worker-policy": "/owner/fixed-worker-pins.json" },
    { ...values, adversarial: true },
  ])
    assert.equal(
      validateCliCommand(["code-feature"], refused, Object.keys(refused)).error,
      "arguments",
    );
});

// ADR 0008: a Claude Code turn names only the auth directory holding the
// owner's Anthropic key. The spend budget is its authority, so no account,
// routed-run approval or usage reader is an option at all.
test("a metered Claude Code turn takes the auth directory and no account or approval", () => {
  const values = {
    id: "d",
    "owner-policy": "/owner/policy.json",
    "podman-machine": "aios-test",
    "coding-admission": "/owner/claude-coding-admission.json",
    "validation-admission": "/owner/validation-admission.json",
    "auth-directory": "/owner/auth",
  };
  for (const name of ["code-feature", "repair-feature"])
    assert.equal(
      validateCliCommand([name], values, Object.keys(values)).name,
      name,
    );
  for (const option of [
    "auth-account",
    "approve-run",
    "approve-turns",
    "turns",
  ]) {
    assert.equal(cliOptions[option], undefined, option);
    for (const name of ["code-feature", "repair-feature"])
      assert.equal(
        validateCliCommand([name], values, [...Object.keys(values), option])
          .error,
        "arguments",
      );
  }
  const { "coding-admission": _, ...unadmitted } = values;
  assert.equal(
    validateCliCommand(["code-feature"], unadmitted, Object.keys(unadmitted))
      .error,
    "arguments",
  );
});

// repair-feature takes code-feature's options under the same rules. Its
// allowance is the repair's own, so it never takes initial coding minutes.
test("repair-feature takes code-feature's options, except coding minutes", async () => {
  const values = {
    id: "d",
    "owner-policy": "/owner/policy.json",
    "onboarding-attestation": "/owner/onboarding-attestation.json",
    "podman-machine": "aios-test",
    "coding-admission": "/owner/claude-coding-admission.json",
    "validation-admission": "/owner/validation-admission.json",
    "auth-directory": "/owner/auth",
  };
  const invocation = validateCliCommand(
    ["repair-feature"],
    values,
    Object.keys(values),
  );
  assert.equal(invocation.name, "repair-feature");
  assert.deepEqual(
    [...invocation.command.optional].sort(),
    cliCommands["code-feature"].optional
      .filter((name) => name !== "coding-minutes")
      .sort(),
  );
  const calls = [];
  await invocation.command.invoke(
    { repairFeature: (...args) => calls.push(args) },
    values,
  );
  assert.deepEqual(calls, [["d"]]);
  for (const refused of [
    { ...values, "coding-minutes": "30" },
    { id: "d", "coding-admission": "/owner/claude-coding-admission.json" },
    { id: "d", "auth-directory": "/owner/auth" },
  ])
    assert.equal(
      validateCliCommand(["repair-feature"], refused, Object.keys(refused))
        .error,
      "arguments",
    );
});

test("ChatGPT sign-in and routed-turn approvals are no commands", () => {
  for (const name of ["authorize-auth", "auth-status", "prepare-routed-turns"])
    assert.equal(cliCommands[name], undefined, name);
});

for (const command of ["code-feature", "repair-feature"])
  test(`${command} from the CLI installs the owner-admitted runtimes without any VM effect`, (t) => {
    const state = mkdtempSync(join(tmpdir(), "aios-cli-code-feature-"));
    t.after(() => rmSync(state, { recursive: true, force: true }));
    chmodSync(state, 0o700);
    const coding = join(state, "claude-coding-admission.json"),
      validation = join(state, "validation-admission.json");
    writeFileSync(
      coding,
      JSON.stringify({
        scope: "aios-claude-coding-admission-v1",
        approvedAt: "2026-10-21T12:00:00.000Z",
        pins: {
          cliVersion: "2.1.311",
          cliSha256: "c".repeat(64),
          policySha256: "d".repeat(64),
          bindingSha256: "e".repeat(64),
        },
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      validation,
      JSON.stringify({
        scope: "aios-native-validation-admission-v1",
        approvedAt: "2026-10-22T12:00:00.000Z",
        pins: {
          imageSha256: "a".repeat(64),
          policySha256: "b".repeat(64),
          bindingSha256: "c".repeat(64),
        },
      }),
      { mode: 0o600 },
    );
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
          command,
          "--id",
          "11111111-2222-4333-8444-555555555555",
          "--state-dir",
          join(state, "state"),
          "--podman-machine",
          "aios-test",
          ...args,
        ],
        { encoding: "utf8" },
      );
    const installed = cli(
      "--coding-admission",
      coding,
      "--validation-admission",
      validation,
      ...(command === "code-feature" ? ["--coding-minutes", "30"] : []),
    );
    assert.equal(installed.status, 1);
    // Both runtimes were installed; only the unknown delivery refuses.
    assert.equal(JSON.parse(installed.stderr).error, "Delivery not found.");
    const missing = cli(
      "--coding-admission",
      join(state, "missing.json"),
      "--validation-admission",
      validation,
    );
    assert.equal(missing.status, 1);
    assert.match(
      JSON.parse(missing.stderr).error,
      /owner coding admission record is missing or invalid/,
    );
    // A metered turn needs the owner's stored Anthropic key (ADR 0008),
    // under the prepared host registration.
    const owned = realpathSync(state),
      repo = join(owned, "repo"),
      auth = join(owned, "auth");
    mkdirSync(repo);
    const prepared = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
        "prepare-auth",
        "--repo",
        repo,
        "--state-dir",
        join(owned, "state"),
        "--auth-directory",
        auth,
      ],
      { encoding: "utf8" },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    // The registration alone: no ChatGPT sign-in fields.
    assert.deepEqual(Object.keys(JSON.parse(prepared.stdout)).sort(), [
      "agentName",
      "credentialsStored",
      "deliveryEnabled",
      "hostId",
      "registrationPath",
      "status",
    ]);
    const unkeyed = cli(
      "--coding-admission",
      coding,
      "--validation-admission",
      validation,
      "--auth-directory",
      auth,
    );
    assert.equal(unkeyed.status, 1);
    assert.match(
      JSON.parse(unkeyed.stderr).error,
      /owner's Anthropic key is missing or invalid/,
    );
  });

test("owner criteria are named only on plan-feature and clarify-feature, never empty", () => {
  for (const [name, values] of [
    ["plan-feature", { id: "d", "feature-criteria": "/owner/criteria.json" }],
    [
      "clarify-feature",
      {
        id: "d",
        clarification: "Use email",
        "feature-criteria": "/owner/criteria.json",
      },
    ],
  ]) {
    assert.equal(
      validateCliCommand([name], values, Object.keys(values)).name,
      name,
    );
    const empty = { ...values, "feature-criteria": "" };
    assert.equal(
      validateCliCommand([name], empty, Object.keys(empty)).error,
      "arguments",
    );
  }
});

test("the CLI installs the owner criteria planner only for the named delivery", (t) => {
  const state = mkdtempSync(join(tmpdir(), "aios-cli-feature-criteria-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      "plan-feature",
      "--id",
      "11111111-2222-4333-8444-555555555555",
      "--state-dir",
      state,
      "--feature-criteria",
      join(state, "criteria.json"),
    ],
    { encoding: "utf8" },
  );
  // No such delivery: planning refuses before the criteria are read.
  assert.equal(result.status, 1);
  assert.equal(typeof JSON.parse(result.stderr).error, "string");
});

test("an onboarding attestation needs the owner policy it attests", () => {
  for (const [name, values] of [
    ["start", { repo: "/r", request: "Add a hint" }],
    ["validate-baseline", { id: "d" }],
    ["validate-candidate", { id: "d" }],
    ["code-feature", { id: "d" }],
  ]) {
    const attested = {
      ...values,
      "owner-policy": "/owner/policy.json",
      "onboarding-attestation": "/owner/onboarding.json",
    };
    assert.equal(
      validateCliCommand([name], attested, Object.keys(attested)).name,
      name,
    );
    for (const refused of [
      { ...values, "onboarding-attestation": "/owner/onboarding.json" },
      { ...attested, "onboarding-attestation": "" },
    ])
      assert.equal(
        validateCliCommand([name], refused, Object.keys(refused)).error,
        "arguments",
        name,
      );
  }
});

test("the CLI records an unusable onboarding attestation as a policy conflict, never as readiness", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aios-cli-attestation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  const policy = join(root, "owner-policy.json");
  writeFileSync(
    policy,
    JSON.stringify({
      repository: "AJHMH/profile-page",
      defaultBranch: "main",
      factoryCommit: "a".repeat(40),
      approver: "aaron-howard",
      appLogin: "factory[bot]",
      publicationLogin: "aaron-howard",
      requiredChecks: ["lint"],
      validation: ["node"],
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      "start",
      "--repo",
      repository,
      "--request",
      "Add a visible contact hint.",
      "--state-dir",
      join(root, "state"),
      "--owner-policy",
      policy,
      "--onboarding-attestation",
      join(root, "missing-attestation.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const delivery = JSON.parse(result.stdout);
  assert.equal(delivery.onboarding.ready, false);
  assert.equal(delivery.onboarding.attestation, undefined);
  assert.equal(
    delivery.onboarding.facts.find((f) => f.requirement === "policy").status,
    "conflict",
  );
});
