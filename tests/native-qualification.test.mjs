import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeliveryController } from "../dist/controller.js";
import { SbxHostAdapter } from "../dist/sbx-host.js";

test("native host observations expose prerequisites without qualifying worker isolation or persisting diagnostic details", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-native-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  const worker = new SbxHostAdapter(() =>
    JSON.stringify({
      version: "1.0",
      checks: [
        {
          name: "Binary version",
          status: "pass",
          message: "v0.47.0",
          detail: "synthetic-sensitive-detail",
        },
        { name: "Virtualization", status: "pass" },
        { name: "Daemon", status: "pass" },
        {
          name: "Authentication",
          status: "fail",
          message: "synthetic-sensitive-detail",
        },
      ],
    }),
  );
  const controller = new DeliveryController(
    join(root, "state"),
    {},
    { worker },
  );
  const delivery = controller.start({ repository, request: "Safe feature" });
  const observed = await controller.qualify(delivery.id);
  assert.equal(observed.qualification.host.sbxVersion, "0.47.0");
  assert.equal(observed.qualification.host.virtualization, "verified");
  assert.equal(observed.qualification.host.authentication, "conflicting");
  assert.equal(observed.qualification.liveReady, false);
  assert.equal(observed.qualification.ready, false);
  assert.ok(
    observed.qualification.probes.every((probe) => probe.outcome === "not-run"),
  );
  assert.match(observed.qualification.blockers.join(" "), /sbx login/);
  assert.equal(
    JSON.stringify(observed).includes("synthetic-sensitive-detail"),
    false,
  );
});
