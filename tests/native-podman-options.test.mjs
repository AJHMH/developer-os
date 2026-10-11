import assert from "node:assert/strict";
import { test } from "node:test";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DeliveryController } from "../dist/controller.js";

test("native enrollment cannot bind candidate-owned authority or candidate pin files", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-native-options-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  for (const [state, pins] of [
    [join(repository, "state"), join(root, "pins.json")],
    [join(root, "state"), join(repository, "pins.json")],
    [join(root, "state"), join(root, "state", "pins.json")],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "pin-offline",
        "--repo",
        repository,
        "--state-dir",
        state,
        "--podman-machine",
        "aios-test",
        "--worker-policy",
        pins,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(existsSync(pins), false);
  }
});

test("native CLI rejects malformed machine selection without modifying an existing delivery", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-native-cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const state = join(root, "state");
  const controller = new DeliveryController(state);
  const delivery = controller.start({
    repository,
    request: "Native CLI validation",
  });
  const result = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "recover",
      "--id",
      delivery.id,
      "--state-dir",
      state,
      "--podman-machine",
      "../unsafe",
      "--worker-policy",
      join(root, "pins.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.deepEqual(controller.status(delivery.id), delivery);
});
