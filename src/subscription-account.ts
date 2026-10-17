import { createHash } from "node:crypto";
export const subscriptionIssuer = "https://auth.openai.com" as const;
export const requiredSubscriptionScopes = [
  "resource.invoke",
  "chatgpt.tokens.use.direct",
] as const;
export const inferenceWindowMs = 30_000;
export interface SubscriptionAccount {
  issuer: string;
  clientId: string;
  subject: string;
  hostId: string;
  accessToken: string;
  scopes: string[];
  expiresAt: number;
  planUsageAuthorized?: boolean;
}
export function subscriptionAccountId(
  account: Pick<
    SubscriptionAccount,
    "issuer" | "clientId" | "subject" | "hostId"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        account.issuer,
        account.clientId,
        account.subject,
        account.hostId,
      ]),
    )
    .digest("hex");
}
export function decodeSubscriptionAccount(
  encoded: string,
  accountId: string,
  hostId: string,
): SubscriptionAccount | undefined {
  try {
    if (encoded.length > 349528 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      return undefined;
    const account = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (
      !account ||
      account.issuer !== subscriptionIssuer ||
      account.hostId !== hostId ||
      typeof account.subject !== "string" ||
      typeof account.clientId !== "string" ||
      !Number.isSafeInteger(account.expiresAt) ||
      !Array.isArray(account.scopes) ||
      account.scopes.some((scope: unknown) => typeof scope !== "string") ||
      typeof account.accessToken !== "string" ||
      !account.accessToken ||
      subscriptionAccountId(account) !== accountId
    )
      return undefined;
    return account;
  } catch {
    return undefined;
  }
}
export function accountEligibility(
  account: SubscriptionAccount,
  now: number,
  deadline = now + inferenceWindowMs,
) {
  const validForInferenceWindow =
    Number.isSafeInteger(now) &&
    now >= 0 &&
    Number.isSafeInteger(deadline) &&
    deadline >= now &&
    Number.isSafeInteger(account.expiresAt) &&
    account.expiresAt > deadline;
  const requiredScopesPresent =
    Array.isArray(account.scopes) &&
    requiredSubscriptionScopes.every((scope) => account.scopes.includes(scope));
  return {
    expired: account.expiresAt <= now,
    validForInferenceWindow,
    requiredScopesPresent,
    eligible:
      account.issuer === subscriptionIssuer &&
      validForInferenceWindow &&
      requiredScopesPresent &&
      account.planUsageAuthorized === true &&
      typeof account.accessToken === "string" &&
      Boolean(account.accessToken),
  };
}
export interface HostRegistration {
  schema: 1;
  hostId: string;
  agentName: "Developer OS";
}
export function validHostRegistration(
  value: unknown,
): value is HostRegistration {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schema === 1 &&
    record.agentName === "Developer OS" &&
    typeof record.hostId === "string" &&
    /^urn:uuid:[a-f0-9-]{36}$/.test(record.hostId) &&
    Object.keys(record).sort().join(",") === "agentName,hostId,schema"
  );
}
