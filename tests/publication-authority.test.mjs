import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { fixture } from "./helpers/publication-controller-fixture.mjs";

for (const [name, patch] of [
  ["signing unavailable", { signingAvailable: false }],
  ["push denied", { publicationAllowed: false }],
  ["App credentials reused for signing", { signingKeySha256: "2".repeat(64) }],
  [
    "broad App permissions",
    { appPermissions: ["pull_requests:write", "contents:write"] },
  ],
  ["wrong repository", { repository: "untrusted/other" }],
  ["wrong App", { appLogin: "owner" }],
  ["multiple approvers", { eligibleApprovers: ["aaron-howard", "other"] }],
])
  test(name + " refuses publication before any effect", async (t) => {
    const f = await fixture(t),
      inspect = f.runtimePublication.inspect.bind(f.runtimePublication);
    f.runtimePublication.inspect = async () => ({
      ...(await inspect()),
      ...patch,
    });
    await assert.rejects(f.controller.publishFeature(f.delivery.id), /blocked/);
    assert.deepEqual(f.events, []);
    assert.equal(f.controller.status(f.delivery.id).publication, undefined);
  });
