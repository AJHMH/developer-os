import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  hostCredentialVault,
  type CredentialVault,
} from "./credential-vault.js";
import { pathContains } from "./path-containment.js";
import {
  accountEligibility,
  decodeSubscriptionAccount,
  validHostRegistration,
} from "./subscription-account.js";
import { assertPrivateAuthStorage } from "./subscription-auth.js";

interface AuthStatusAdapters {
  platform: NodeJS.Platform;
  arch: string;
  now: () => number;
  registration: (
    directory: string,
    repository: string,
    authority: string,
  ) => { hostId: string };
  vault: (directory: string) => CredentialVault;
}
function registration(
  directory: string,
  repository: string,
  authority: string,
) {
  const paths = [directory, repository, authority].map((path) => {
    if (
      !isAbsolute(path) ||
      lstatSync(path).isSymbolicLink() ||
      !lstatSync(path).isDirectory()
    )
      throw Error();
    const canonical = realpathSync(path);
    if (canonical.toLowerCase() !== resolve(path).toLowerCase()) throw Error();
    return canonical;
  });
  const inside = pathContains;
  if (paths.some((a, i) => paths.some((b, j) => i !== j && inside(a, b))))
    throw Error();
  return hostRegistration(directory);
}
/** The host registration in a private auth directory. */
export function hostRegistration(directory: string): { hostId: string } {
  const file = join(directory, "registration.json");
  assertPrivateAuthStorage(directory, "directory");
  assertPrivateAuthStorage(file, "file");
  const record = JSON.parse(readFileSync(file, "utf8"));
  if (!validHostRegistration(record)) throw Error();
  return record;
}

/** Explicit trusted-host inspection only. No network, writes, refresh or approval. */
export function inspectSubscriptionAuth(
  directory: string,
  repository: string,
  authority: string,
  accountId: string,
  adapters: AuthStatusAdapters = {
    platform: process.platform,
    arch: process.arch,
    now: Date.now,
    registration,
    vault: (directory) => hostCredentialVault(directory, true),
  },
) {
  const denied = {
    status: "unavailable",
    reason: "storage-or-account",
    validForInferenceWindow: false,
    inferenceAuthorized: false,
    productionEnabled: false,
  } as const;
  try {
    if (
      !/^[a-f0-9]{64}$/.test(accountId) ||
      !(
        (adapters.platform === "win32" && adapters.arch === "x64") ||
        (adapters.platform === "darwin" && adapters.arch === "arm64")
      )
    )
      return denied;
    const host = adapters.registration(directory, repository, authority);
    const account = decodeSubscriptionAccount(
      adapters.vault(directory).read(accountId),
      accountId,
      host.hostId,
    );
    if (!account) return denied;
    const now = adapters.now();
    if (!Number.isSafeInteger(now) || now < 0) return denied;
    const {
      expired,
      validForInferenceWindow,
      requiredScopesPresent,
      eligible,
    } = accountEligibility(account, now);
    return {
      status: eligible ? "eligible" : "sign-in-required",
      expired,
      validForInferenceWindow,
      requiredScopesPresent,
      planUsageAuthorized: account.planUsageAuthorized === true,
      inferenceAuthorized: false,
      productionEnabled: false,
    };
  } catch {
    return denied;
  }
}
