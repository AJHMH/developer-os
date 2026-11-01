import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GeneralSessionFactory } from "./controller.js";
import { type CodingPins, codingPinFields } from "./feature-candidate.js";

/** ADR 0002 live inference: each routed run is gated by a fresh, one-shot
 * owner approval naming the run and its turns, at most two. A plan the owner
 * has not approved within this window lapses. */
export const routedTurnPlanMs = 60 * 60_000;
const maxTurns = 2;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export interface RoutedTurnPlan {
  schema: 1;
  runId: string;
  deliveryId: string;
  accountId: string;
  machine: string;
  pinsSha256: string;
  turns: number;
  createdAt: string;
  expiresAt: number;
}
interface RoutedTurnScope {
  deliveryId: string;
  accountId: string;
  machine: string;
  pins: CodingPins;
}
const pinsSha256 = (pins: CodingPins) =>
  createHash("sha256")
    .update(JSON.stringify(codingPinFields.map((field) => pins[field])))
    .digest("hex");
const planPath = (state: string, runId: string) =>
  join(state, `routed-turns-${runId}.plan.json`);
const consumedPath = (state: string, runId: string, turn: number) =>
  join(state, `routed-turns-${runId}-${turn}.consumed`);

/** The owner's plan in the controller's private state: what the one-shot
 * approval names. */
export function prepareRoutedTurns(
  state: string,
  scope: RoutedTurnScope & { turns: number },
  now = Date.now(),
): RoutedTurnPlan {
  if (![1, maxTurns].includes(scope.turns))
    throw Error("A routed run names 1 or 2 turns");
  const plan: RoutedTurnPlan = {
    schema: 1,
    runId: randomUUID(),
    deliveryId: scope.deliveryId,
    accountId: scope.accountId,
    machine: scope.machine,
    pinsSha256: pinsSha256(scope.pins),
    turns: scope.turns,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + routedTurnPlanMs,
  };
  writeFileSync(planPath(state, plan.runId), JSON.stringify(plan, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  return plan;
}

export interface RoutedTurnApproval {
  /** Spends one approved turn for `deliveryId`, or throws. */
  spend(deliveryId: string): void;
}

/** The owner's approval, checked against its current plan before any turn.
 * Each routed turn spends one approved turn with an exclusive marker, so no
 * process can spend more than the plan names. */
export function approvedRoutedTurns(
  state: string,
  approval: RoutedTurnScope & { runId: string; turns: number },
  clock: () => number = Date.now,
): RoutedTurnApproval {
  const refused = () => Error("The approval does not match a current plan");
  if (!uuid.test(approval.runId)) throw refused();
  let plan: RoutedTurnPlan;
  try {
    plan = JSON.parse(readFileSync(planPath(state, approval.runId), "utf8"));
  } catch {
    throw refused();
  }
  const current = () =>
    Number.isSafeInteger(plan.expiresAt) && clock() < plan.expiresAt;
  if (
    plan.schema !== 1 ||
    plan.runId !== approval.runId ||
    plan.deliveryId !== approval.deliveryId ||
    plan.accountId !== approval.accountId ||
    plan.machine !== approval.machine ||
    plan.pinsSha256 !== pinsSha256(approval.pins) ||
    plan.turns !== approval.turns ||
    ![1, maxTurns].includes(plan.turns) ||
    !current()
  )
    throw refused();
  return {
    spend(deliveryId) {
      if (deliveryId !== plan.deliveryId)
        throw Error("The approval names another delivery");
      if (!current()) throw Error("The approved run has expired");
      for (let turn = 1; turn <= plan.turns; turn++)
        try {
          writeFileSync(
            consumedPath(state, plan.runId, turn),
            "one-shot approval consumed\n",
            { flag: "wx", mode: 0o600 },
          );
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      throw Error("The approved turns are spent");
    },
  };
}

/** Routed sessions that open only after a turn of the owner's approval is
 * spent. A refusal throws before the gateway opens, and the controller then
 * stops the prepared session. */
export function approvedGeneralSessions(
  sessions: GeneralSessionFactory,
  approval: RoutedTurnApproval,
): GeneralSessionFactory {
  return (turn, authority) => {
    approval.spend(turn.deliveryId);
    return sessions(turn, authority);
  };
}
