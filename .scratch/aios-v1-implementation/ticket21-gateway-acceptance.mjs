// Public controller/status seam; native Codex uses synthetic host credentials only.
import "./ticket21-endpoint-acceptance.mjs";
import assert from "node:assert/strict";
import { DeliveryController } from "../../dist/controller.js";
import { writeFileSync } from "node:fs";
const status = new DeliveryController("/Users/aaronhoward/.developer-os/ticket4-macos/state").status(process.argv[2]);
const report = status.qualification.subscriptionMediation;
assert.equal(report.hostGateway, "passed");
assert.equal(report.gatewayIntegration, "passed");
assert.equal(report.gatewayScope, "synthetic-host-subscription");
assert.equal(report.subscriptionInference, "not-run");
assert.equal(report.qualified, false);
writeFileSync(new URL("ticket21-gateway-observation.json", import.meta.url), JSON.stringify({ observedAt: new Date().toISOString(), scope: "Actual isolated Codex through VM relay to host-only subscription gateway with synthetic account/provider; no live inference", qualification: status.qualification }, null, 2) + "\n");
