import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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
test("usage approval and PR rerun dispatch the independently required check identifier", async () => {
  const calls = [];
  const controller = {
    approveUsage: (...args) => calls.push(["usage", ...args]),
    rerunPRCheck: (...args) => calls.push(["rerun", ...args]),
  };
  for (const name of ["approve-usage", "rerun-pr-check"]) {
    const values = { id: "delivery", "check-id": "check" };
    const invocation = validateCliCommand([name], values, Object.keys(values));
    assert.equal(invocation.name, name);
    await invocation.command.invoke(controller, values);
  }
  assert.deepEqual(calls, [
    ["usage", "delivery", "check"],
    ["rerun", "delivery", "check"],
  ]);
});
test("native prerequisites and numeric extensions remain bounded", () => {
  for (const values of [
    { id: "d", adversarial: true },
    { id: "d", "podman-machine": "other" },
    { id: "d", "worker-policy": "" },
  ]) {
    assert.equal(
      validateCliCommand(["qualify"], values, Object.keys(values)).error,
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

test("a missing owner coding admission refuses before any delivery or VM effect", (t) => {
  const state = mkdtempSync(join(tmpdir(), "aios-cli-coding-admission-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      "pause",
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
