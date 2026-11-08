// The warning prepare prints when Podman Desktop is open on macOS, with no
// real process. The name sorts after every other test file, so no other file
// changes shard.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { test } from "node:test";
import { offlineValidationEnvironment } from "../dist/native-validation.js";
import { privateRoot } from "../scripts/run-native-cli-delivery-acceptance.mjs";
import {
  podmanDesktopRunning,
  podmanDesktopWarning,
  prepareRouted,
} from "../scripts/run-native-routed-delivery.mjs";

const answers = {
  start: { id: randomUUID(), onboarding: { ready: true } },
  "plan-feature": { feature: { outcome: "planned" } },
  "validate-baseline": {
    validation: {
      attempts: [{ stage: "baseline", state: "stopped", outcome: "passed" }],
    },
  },
  qualify: {
    qualification: {
      offlineAdmission: { allowed: true },
      subscriptionMediation: { gatewayIntegration: "passed" },
    },
  },
};
const host = {
  state: "/owner/state",
  machine: "aios-test",
  workerPolicy: "/owner/fixed-worker-pins.json",
  codingAdmission: "/owner/coding-admission.json",
  validationAdmission: "/owner/validation-admission.json",
  codex: "/owner/codex",
  authDirectory: "/owner/auth",
  authAccount: "a".repeat(64),
};
const macOS = (probe) => () =>
  podmanDesktopRunning({ platform: "darwin", probe });

/** A whole prepare with the given check. Returns everything it did, in order:
 * each CLI and script process, and each warning. */
async function prepare(t, podmanDesktop) {
  const root = await privateRoot("aios-routed-warning-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const order = [];
  const session = await prepareRouted({
    run: async ([command]) => {
      order.push(command);
      return answers[command];
    },
    script: async (name) => {
      order.push(name);
      return { status: "prepared", runId: randomUUID() };
    },
    podmanDesktop,
    warn: (line) => order.push(`warning: ${line}`),
    host,
    root,
    environment: offlineValidationEnvironment("e".repeat(64)),
  });
  assert.equal(session.deliveryId, answers.start.id);
  return order;
}
const steps = [
  "start",
  "plan-feature",
  "validate-baseline",
  "qualify",
  "record-mediation-decision",
];

test("prepare warns once before it starts a delivery when Podman Desktop is running, and carries on", async (t) => {
  assert.deepEqual(
    await prepare(
      t,
      macOS(() => ({ status: 0 })),
    ),
    [`warning: ${podmanDesktopWarning}`, ...steps],
  );
  assert.doesNotMatch(podmanDesktopWarning, /\n/);
});

test("prepare says nothing when Podman Desktop is not running", async (t) => {
  assert.deepEqual(
    await prepare(
      t,
      macOS(() => ({ status: 1 })),
    ),
    steps,
  );
});

test("prepare says nothing off macOS, without looking for the app", async (t) => {
  for (const platform of ["linux", "freebsd"])
    assert.deepEqual(
      await prepare(t, () =>
        podmanDesktopRunning({
          platform,
          probe: () => assert.fail("The check ran off macOS"),
        }),
      ),
      steps,
    );
});

test("a check that fails counts as not running", async (t) => {
  const failures = [
    () => {
      throw Error("spawn failed");
    },
    // No such program, or a timeout: spawnSync reports no status.
    () => ({ status: null, error: Error("ENOENT") }),
    // pgrep's own error statuses.
    () => ({ status: 2 }),
    () => ({ status: 3 }),
  ];
  for (const probe of failures)
    assert.deepEqual(await prepare(t, macOS(probe)), steps);
});

test("the check looks for the app's path among host processes, and can't hang prepare", () => {
  const calls = [];
  podmanDesktopRunning({
    platform: "darwin",
    probe: (...call) => {
      calls.push(call);
      return { status: 1 };
    },
  });
  assert.equal(calls.length, 1);
  const [[program, args, options]] = calls;
  assert.equal(program, "/usr/bin/pgrep");
  assert.deepEqual(args, ["-f", "Podman Desktop.app"]);
  assert.equal(options.stdio, "ignore");
  assert.ok(options.timeout > 0);
});
