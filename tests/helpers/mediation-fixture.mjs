import assert from "node:assert/strict";
import { DeliveryController } from "../../dist/controller.js";
import { syntheticMediation } from "../../scripts/synthetic-mediation.mjs";

/** Give a coding fixture a worker probe and an owner-endorsed macOS mediation
 * decision endorsing `usageAccountId` as its usage-reader account, through
 * the public qualification path; without `usageAccountId` the record awaits
 * endorsement and does not qualify. `coordination` adds controller options,
 * such as a general-session factory. Returns `recordPath`,
 * `regress()`, which fails the probe's gateway evidence, and `withdraw()`,
 * which removes the protected decision record again. */
export async function mediatedCoding(f, t, usageAccountId, coordination = {}) {
  const id = f.delivery.id;
  const mediation = await syntheticMediation({
    state: f.state,
    deliveryId: id,
    repository: f.repository,
    usageAccountId,
  });
  t.after(mediation.remove);
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    worker: { probe: async () => structuredClone(mediation.probe) },
    ...coordination,
  });
  const qualified = await f.controller.qualify(id);
  assert.equal(
    qualified.qualification.subscriptionMediation.mechanismDecision?.qualified,
    usageAccountId === undefined ? undefined : true,
    "the synthetic decision must genuinely qualify once endorsed",
  );
  return {
    recordPath: mediation.recordPath,
    regress: mediation.regress,
    withdraw: async () => {
      mediation.withdraw();
      await f.controller.qualify(id);
    },
  };
}
