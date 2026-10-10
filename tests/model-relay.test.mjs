import assert from "node:assert/strict";
import { test } from "node:test";
import { syntheticRelayCanary } from "../dist/model-relay.js";

test("synthetic model relay verifies bounded transport and denial paths without live credentials", async () => {
  // The canary proves the fixed response, refuses alternate routes, credentials
  // and methods, strips the owner header, and rechecks transport after refusal.
  // Every peer is a fresh local loopback server; no account or inference is used.
  assert.equal(await syntheticRelayCanary(), "passed");
});

test("synthetic relay closes its peers and can repeat with fresh capabilities", async () => {
  assert.equal(await syntheticRelayCanary(), "passed");
  assert.equal(await syntheticRelayCanary(), "passed");
});
