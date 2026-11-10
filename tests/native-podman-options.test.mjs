import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DeliveryController } from "../dist/controller.js";

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
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.deepEqual(controller.status(delivery.id), delivery);
});
