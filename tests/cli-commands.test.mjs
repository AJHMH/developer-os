import assert from "node:assert/strict";
import { test } from "node:test";
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
