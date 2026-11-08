import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CredentialVault } from "./credential-vault.js";
import { DeliveryError } from "./errors.js";
import { hostRegistration } from "./general-sessions.js";
import { assertPrivateAuthStorage } from "./private-storage.js";

/** ADR 0006: metered model access. The owner's Anthropic API key lives only in
 * the host's protected Keychain, under an account identified by its
 * organization, key fingerprint and host. Nothing here grants a coding turn:
 * the spend budget does (ADR 0008). */

export const anthropicOrigin = "https://api.anthropic.com" as const;
export const anthropicApiVersion = "2023-06-01" as const;
/** The non-secret record naming which vault account holds the key. */
export const anthropicAccountRecord = "anthropic-account.json" as const;

export interface AnthropicAccount {
  provider: "anthropic";
  hostId: string;
  organizationId: string;
  keyFingerprint: string;
  apiKey: string;
}
export type AnthropicAccountIdentity = Omit<AnthropicAccount, "apiKey">;
export interface AnthropicAccountRecord extends AnthropicAccountIdentity {
  schema: 1;
  accountId: string;
}

const hex64 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const hostIdentity = (value: unknown): value is string =>
  typeof value === "string" && /^urn:uuid:[a-f0-9-]{36}$/.test(value);
const organization = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);

/** A standard (not admin) Anthropic API key. */
export function validAnthropicApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,256}$/.test(value)
  );
}

export function anthropicKeyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function anthropicAccountId(
  identity: Pick<
    AnthropicAccountIdentity,
    "hostId" | "organizationId" | "keyFingerprint"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "anthropic",
        identity.organizationId,
        identity.keyFingerprint,
        identity.hostId,
      ]),
    )
    .digest("hex");
}

export function encodeAnthropicAccount(account: AnthropicAccount): string {
  return Buffer.from(JSON.stringify(account), "utf8").toString("base64");
}

/** The vault entry, or undefined unless it is exactly the named account. */
export function decodeAnthropicAccount(
  encoded: string,
  accountId: string,
  hostId: string,
): AnthropicAccount | undefined {
  try {
    if (encoded.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      return undefined;
    const a = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (
      !a ||
      Object.keys(a).sort().join(",") !==
        "apiKey,hostId,keyFingerprint,organizationId,provider" ||
      a.provider !== "anthropic" ||
      a.hostId !== hostId ||
      !organization(a.organizationId) ||
      !validAnthropicApiKey(a.apiKey) ||
      a.keyFingerprint !== anthropicKeyFingerprint(a.apiKey) ||
      anthropicAccountId(a) !== accountId
    )
      return undefined;
    return a;
  } catch {
    return undefined;
  }
}

export type AnthropicFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "error";
    signal: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
}>;

/** One free request (listing a single model, no tokens) that proves the key
 * works and names its organization. The key never appears in an error. */
export async function verifyAnthropicKey(
  apiKey: string,
  fetchImpl: AnthropicFetch = fetch as unknown as AnthropicFetch,
  timeoutMs = 15_000,
): Promise<{ organizationId: string }> {
  if (!validAnthropicApiKey(apiKey))
    throw new DeliveryError(
      "That is not a standard Anthropic API key (sk-ant-api…). Admin keys are refused.",
    );
  let response;
  try {
    response = await fetchImpl(`${anthropicOrigin}/v1/models?limit=1`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": anthropicApiVersion,
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new DeliveryError(
      "Anthropic could not be reached to verify the key; nothing was stored.",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new DeliveryError(
      "Anthropic refused the key; nothing was stored. Check it is active in the Anthropic Console.",
    );
  if (response.status !== 200)
    throw new DeliveryError(
      `Anthropic answered the key check with HTTP ${response.status}; nothing was stored.`,
    );
  const organizationId = response.headers.get("anthropic-organization-id");
  if (!organization(organizationId))
    throw new DeliveryError(
      "Anthropic's answer named no organization for the key; nothing was stored.",
    );
  return { organizationId };
}

function readRecord(directory: string): AnthropicAccountRecord | undefined {
  const file = join(directory, anthropicAccountRecord);
  if (!existsSync(file)) return undefined;
  assertPrivateAuthStorage(file, "file");
  const r = JSON.parse(readFileSync(file, "utf8"));
  if (
    !r ||
    r.schema !== 1 ||
    r.provider !== "anthropic" ||
    !hex64(r.accountId) ||
    !hostIdentity(r.hostId) ||
    !organization(r.organizationId) ||
    !hex64(r.keyFingerprint) ||
    anthropicAccountId(r) !== r.accountId
  )
    throw new DeliveryError("The Anthropic account record is invalid.");
  return r;
}

/** The stored account's public identity, if one is stored. */
export function anthropicAccount(
  directory: string,
): AnthropicAccountRecord | undefined {
  assertPrivateAuthStorage(directory, "directory");
  const record = readRecord(directory);
  if (record && record.hostId !== hostRegistration(directory).hostId)
    throw new DeliveryError(
      "The Anthropic account record belongs to another host registration.",
    );
  return record;
}

/** Verifies the key once, writes it to the vault, then records which account
 * holds it. Replacing a stored key needs `replace`. */
export async function storeAnthropicKey(options: {
  directory: string;
  apiKey: string;
  vault: () => Pick<CredentialVault, "write">;
  fetch?: AnthropicFetch;
  replace?: boolean;
}): Promise<{
  status: "stored";
  accountId: string;
  organizationId: string;
  keyFingerprint: string;
  deliveryEnabled: false;
}> {
  const { directory } = options;
  assertPrivateAuthStorage(directory, "directory");
  let hostId: string;
  try {
    hostId = hostRegistration(directory).hostId;
  } catch {
    throw new DeliveryError(
      "The owner's host registration is missing or invalid. Prepare it with prepare-auth first.",
    );
  }
  const apiKey = options.apiKey.trim();
  const existing = readRecord(directory);
  if (existing && !options.replace)
    throw new DeliveryError(
      "An Anthropic key is already stored. Re-run with --replace to replace it.",
    );
  const { organizationId } = await verifyAnthropicKey(apiKey, options.fetch);
  const identity = {
    provider: "anthropic" as const,
    hostId,
    organizationId,
    keyFingerprint: anthropicKeyFingerprint(apiKey),
  };
  const accountId = anthropicAccountId(identity);
  try {
    options
      .vault()
      .write(
        accountId,
        encodeAnthropicAccount({ ...identity, apiKey }),
        existing?.accountId === accountId,
      );
  } catch {
    throw new DeliveryError(
      "The key could not be written to the protected macOS Keychain; nothing was recorded.",
    );
  }
  const record: AnthropicAccountRecord = { schema: 1, accountId, ...identity };
  const file = join(directory, anthropicAccountRecord),
    pending = file + ".pending";
  writeFileSync(pending, JSON.stringify(record), {
    mode: 0o600,
    flag: "w",
    flush: true,
  });
  renameSync(pending, file);
  return {
    status: "stored",
    accountId,
    organizationId,
    keyFingerprint: identity.keyFingerprint,
    deliveryEnabled: false,
  };
}

/** The key for a model request, read from the vault at that moment. */
export function readAnthropicKey(
  vault: Pick<CredentialVault, "read">,
  record: Pick<AnthropicAccountRecord, "accountId" | "hostId">,
): AnthropicAccount {
  let encoded: string;
  try {
    encoded = vault.read(record.accountId);
  } catch {
    throw new DeliveryError("The owner's Anthropic key is unavailable.");
  }
  const account = decodeAnthropicAccount(
    encoded,
    record.accountId,
    record.hostId,
  );
  if (!account)
    throw new DeliveryError("The owner's Anthropic key is unavailable.");
  return account;
}
