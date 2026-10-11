// Credential-free actual Codex worker qualification through controller/status.
import "./ticket21-native-acceptance.mjs";
import assert from "node:assert/strict";
import { DeliveryController } from "../../dist/controller.js";
import { writeFileSync } from "node:fs";
const s = new DeliveryController(
  "/Users/aaronhoward/.developer-os/ticket4-macos/state",
).status(process.argv[2]);
assert.equal(s.qualification.subscriptionMediation.workerProtocol, "passed");
assert.equal(
  s.qualification.subscriptionMediation.codexCredentialIsolation,
  "passed",
);
assert.equal(s.qualification.subscriptionMediation.endpointEnforcement, "passed");
assert.equal(s.qualification.subscriptionMediation.deliveryCapabilities, "passed");
assert.equal(s.qualification.subscriptionMediation.relayDeliveryId, process.argv[2]);
assert.deepEqual(s.qualification.subscriptionMediation.deliveryCapabilityChecks, ["cross-delivery", "namespace", "revocation", "quota", "expiry"]);
assert.equal(s.qualification.subscriptionMediation.qualified, false);
writeFileSync(
  new URL("ticket21-codex-endpoint-observation.json", import.meta.url),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      qualification: s.qualification,
      scope:
        "Credential-free Codex-to-synthetic-relay endpoint and delivery capability qualification; no subscription request",
    },
    null,
    2,
  ) + "\n",
);
