// Coding turns driven through the controller, offline or routed through a
// general-session fake. Shared by the usage and restart tests.
import { randomUUID } from "node:crypto";
import { codingFixture } from "./feature-fixture.mjs";
import { mediatedCoding } from "./mediation-fixture.mjs";
import { planAndValidate } from "./validation-fixture.mjs";
import { failedTurn } from "./coding-turns.mjs";

// Coding records every dispatch attempt; a launch never reaches the runtime
// without fresh model-only usage authority bound to its exact operation.
export async function authorizedCoding(t) {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    dispatched = [];
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return normal(request);
  };
  await planAndValidate(f);
  return { f, dispatched };
}

export const mediatedAccount = "c".repeat(64);
// Usage observations from the given account, at each controller's clock.
export function observeAccount(f, accountId) {
  const healthy = f.subscription;
  f.subscription = async (at) => ({ ...(await healthy(at)), accountId });
}

// Slice 4a: with a general-session factory, a mediated turn is routed. The
// factory's gateway serves the turn on the host, and its authority callback
// re-observes usage and re-qualifies the decision at each model request.
export function generalSessions() {
  const sessions = [];
  const factory = (turn, authority) => {
    const gateway = {
      capability: randomUUID().replaceAll("-", "").repeat(2),
      respond: async () => {
        throw Error("unused");
      },
      revoke: (reason) => gateway.revoked.push(reason),
      revoked: [],
    };
    sessions.push({ turn, authority, gateway });
    return gateway;
  };
  return { sessions, factory };
}
export async function routedCoding(t, turn = failedTurn, coordination = {}) {
  const { f, dispatched } = await authorizedCoding(t);
  const launches = [];
  f.runtime.execute = async (request, gateway) => {
    dispatched.push(request.operationId);
    launches.push({ request, gateway });
    return turn(request, gateway);
  };
  const { sessions, factory } = generalSessions();
  const mediation = await mediatedCoding(f, t, mediatedAccount, {
    generalSessions: factory,
    ...coordination,
  });
  observeAccount(f, mediatedAccount);
  return { f, dispatched, launches, sessions, factory, mediation };
}
