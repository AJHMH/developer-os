import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { macKeychainStore } from "./keychain-store.js";
import { windowsAuthStore } from "./windows-auth-store.js";
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
  readAccount: (directory: string, accountId: string) => string;
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
  const inside = (parent: string, child: string) => {
    const r = relative(parent, child);
    return (
      r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r))
    );
  };
  if (paths.some((a, i) => paths.some((b, j) => i !== j && inside(a, b))))
    throw Error();
  const file = join(directory, "registration.json");
  assertPrivateAuthStorage(directory, "directory");
  assertPrivateAuthStorage(file, "file");
  if (process.platform === "win32") windowsAuthStore(directory, [file]);
  const record = JSON.parse(readFileSync(file, "utf8"));
  if (
    record.schema !== 1 ||
    record.agentName !== "Developer OS" ||
    !/^urn:uuid:[a-f0-9-]{36}$/.test(record.hostId) ||
    Object.keys(record).sort().join(",") !== "agentName,hostId,schema"
  )
    throw Error();
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
    readAccount: (directory, id) =>
      (process.platform === "win32"
        ? windowsAuthStore(directory)
        : macKeychainStore(directory, true)
      ).read(id),
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
    const encoded = adapters.readAccount(directory, accountId);
    if (encoded.length > 349528 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      return denied;
    const account = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (
      account.issuer !== "https://auth.openai.com" ||
      account.hostId !== host.hostId ||
      typeof account.subject !== "string" ||
      typeof account.clientId !== "string" ||
      createHash("sha256")
        .update(
          JSON.stringify([
            account.issuer,
            account.clientId,
            account.subject,
            account.hostId,
          ]),
        )
        .digest("hex") !== accountId ||
      !Number.isSafeInteger(account.expiresAt) ||
      !Array.isArray(account.scopes) ||
      typeof account.accessToken !== "string" ||
      !account.accessToken
    )
      return denied;
    const now = adapters.now();
    if (!Number.isSafeInteger(now) || now < 0) return denied;
    const expired = account.expiresAt <= now;
    const validForInferenceWindow = account.expiresAt > now + 30000;
    const requiredScopesPresent = [
      "resource.invoke",
      "chatgpt.tokens.use.direct",
    ].every((scope) => account.scopes.includes(scope));
    const eligible =
      validForInferenceWindow &&
      requiredScopesPresent &&
      account.planUsageAuthorized === true;
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
