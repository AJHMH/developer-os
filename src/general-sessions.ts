import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeneralSessionFactory } from "./controller.js";
import {
  hostCredentialVault,
  type CredentialVault,
} from "./credential-vault.js";
import {
  GeneralSessionGateway,
  generalSessionLimits,
  generalSessionResponses,
  type GeneralSessionProvider,
} from "./general-session-gateway.js";
import { assertPrivateAuthStorage } from "./private-storage.js";
import {
  decodeSubscriptionAccount,
  validHostRegistration,
  type HostRegistration,
} from "./subscription-account.js";
import type { GatewayAccount } from "./subscription-gateway.js";

/** The host registration in the owner's private auth directory, read as
 * `inspectSubscriptionAuth` reads it. */
export function hostRegistration(directory: string): HostRegistration {
  const file = join(directory, "registration.json");
  assertPrivateAuthStorage(directory, "directory");
  assertPrivateAuthStorage(file, "file");
  const record = JSON.parse(readFileSync(file, "utf8"));
  if (!validHostRegistration(record))
    throw Error("The host registration is invalid");
  return record;
}

/** The owner's account from the host vault. Read at each model request, so a
 * changed or expired account is seen. */
export function vaultAccount(
  vault: Pick<CredentialVault, "read">,
  accountId: string,
  hostId: string,
): () => GatewayAccount {
  return () => {
    const current = decodeSubscriptionAccount(
      vault.read(accountId),
      accountId,
      hostId,
    );
    if (!current) throw Error("The owner's account is unavailable");
    // Eligibility needs `true`; an absent authorization is none.
    return {
      ...current,
      planUsageAuthorized: current.planUsageAuthorized === true,
    };
  };
}

/** ADR 0004 slice 5: the credential-backed general sessions for the owner's
 * `accountId` in the private auth `directory`. Each routed turn gets a real
 * `GeneralSessionGateway` on the host, with the vault account and the real
 * provider; the credential never leaves the host. A turn for another
 * account is refused before any gateway opens. The registration is read now;
 * the vault is opened and read only at a model request. */
export function credentialedGeneralSessions(
  directory: string,
  accountId: string,
  options: {
    vault?: Pick<CredentialVault, "read">;
    provider?: GeneralSessionProvider;
  } = {},
): GeneralSessionFactory {
  const { hostId } = hostRegistration(directory);
  // Opened at the first model request, never to set a turn up.
  let vault = options.vault;
  const account = vaultAccount(
    { read: (id) => (vault ??= hostCredentialVault(directory, true)).read(id) },
    accountId,
    hostId,
  );
  const provider = options.provider ?? generalSessionResponses();
  return (turn, authority) => {
    if (turn.accountId !== accountId)
      throw Error("The routed turn names another account");
    return new GeneralSessionGateway(
      {
        deliveryId: turn.deliveryId,
        sessionId: turn.sessionId,
        accountId,
        hostId,
        expiresAt: turn.expiresAt,
        maxRequests: generalSessionLimits.maxRequests,
      },
      account,
      authority,
      provider,
    );
  };
}
