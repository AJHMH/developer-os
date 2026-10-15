import assert from "node:assert/strict";
import { fixture } from "./publication-controller-fixture.mjs";

export async function publicationEvidence(t, stage, patch) {
  const f = await fixture(t),
    original = f.runtimePublication[stage].bind(f.runtimePublication);
  f.runtimePublication[stage] = async (r) => ({
    ...(await original(r)),
    ...patch,
    credential: "never-record-this",
  });
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "blocked");
  assert.equal(d.publication.effects.at(-1).reason, "unverified");
  assert.equal(JSON.stringify(d).includes("never-record-this"), false);
  if (stage === "sign") assert.deepEqual(f.events, ["sign"]);
  if (stage === "push") assert.deepEqual(f.events, ["sign", "push"]);
}
