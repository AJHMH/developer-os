import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";

test("qualification records explicit not-run evidence and blocks launch when no runtime or policy is configured", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-isolation-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  const controller = new DeliveryController(join(root, "state"));
  const delivery = controller.start({
    repository,
    request: "Safe worker feature",
  });
  const report = await controller.qualify(delivery.id);
  assert.equal(report.qualification.ready, false);
  assert.equal(report.qualification.liveReady, false);
  assert.ok(
    report.qualification.probes.some((probe) => probe.outcome === "not-run"),
  );
  assert.equal(report.phase, "blocked");
  assert.deepEqual(
    new DeliveryController(join(root, "state")).status(delivery.id)
      .qualification,
    report.qualification,
  );
});
