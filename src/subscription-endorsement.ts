import {
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { assertPrivateAuthStorage } from "./private-storage.js";
import { assessSubscription, type SubscriptionReader } from "./subscription.js";
import {
  hex,
  subscriptionDecisionPath,
  uuid,
} from "./subscription-decision.js";

export interface UsageEndorsement {
  /** The usage reader's account hash for the owner's current subscription. */
  usageAccountId: string;
  /** Whether this call changed the protected decision record. */
  written: boolean;
  /** Whether the record already named this usage account. */
  alreadyEndorsed: boolean;
}

/** Thrown for every refusal, with an operator-safe message. */
export class EndorsementRefusal extends Error {
  override name = "EndorsementRefusal";
}

/** Owner-run endorsement of which usage-reader account a protected mediation
 * decision record belongs to. It reads a fresh, measured usage observation,
 * previews its account by default, and writes `usageAccountId` only with
 * `confirm`, which also requires the previewed account. The new record is
 * written to a private temporary file and renamed over the old one, so an
 * interrupted write leaves the original record. It never re-binds a record
 * already endorsed for another account. */
export async function endorseUsageAccount(options: {
  state: string;
  deliveryId: string;
  reader: SubscriptionReader;
  expectedUsageAccountId?: string;
  confirm?: boolean;
  now?: () => number;
}): Promise<UsageEndorsement> {
  const refuse = (reason: string): never => {
    throw new EndorsementRefusal("Usage endorsement refused: " + reason + ".");
  };
  if (!uuid(options.deliveryId)) refuse("the delivery id is invalid");
  if (options.confirm && options.expectedUsageAccountId === undefined)
    refuse("writing requires the previewed usage account");
  let state = "";
  let recordPath = "";
  let record;
  try {
    state = realpathSync(options.state);
    assertPrivateAuthStorage(state, "directory");
    recordPath = subscriptionDecisionPath(state, options.deliveryId);
    assertPrivateAuthStorage(recordPath, "file", 65536);
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch {
    refuse("the decision record is missing, unreadable or not private");
  }
  if (
    record?.schema !== 1 ||
    record.deliveryId !== options.deliveryId ||
    !hex(record.accountId)
  )
    refuse("the decision record is not a mediation decision for this delivery");
  let observation;
  try {
    observation = await options.reader();
  } catch {
    observation = undefined;
  }
  const usage = assessSubscription(observation, (options.now ?? Date.now)());
  // Only a fresh, measured observation identifies the subscription's account.
  if (!hex(usage.accountId) || usage.remainingPercent === null)
    refuse("no fresh, measured usage observation identifies the account");
  const usageAccountId = usage.accountId!;
  if (
    options.expectedUsageAccountId !== undefined &&
    options.expectedUsageAccountId !== usageAccountId
  )
    refuse("the observed usage account is not the expected one");
  if (record.usageAccountId !== undefined) {
    if (record.usageAccountId !== usageAccountId)
      refuse("the record is already endorsed for another usage account");
    return { usageAccountId, written: false, alreadyEndorsed: true };
  }
  if (!options.confirm)
    return { usageAccountId, written: false, alreadyEndorsed: false };
  const temporary = join(state, ".pending-endorsement-" + randomUUID());
  try {
    writeFileSync(temporary, JSON.stringify({ ...record, usageAccountId }), {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    // The temporary file inherits the private directory's access; refuse
    // before replacing the record if it did not.
    assertPrivateAuthStorage(temporary, "file", 65536);
    renameSync(temporary, recordPath);
  } catch {
    refuse("the endorsement could not be written; the record is unchanged");
  } finally {
    rmSync(temporary, { force: true });
  }
  return { usageAccountId, written: true, alreadyEndorsed: false };
}
