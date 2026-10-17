import { createServer } from "node:http";
import { dirname } from "node:path";
import {
  AuthorizationFailure,
  AuthorizationHttpFailure,
  SubscriptionAuthBroker,
  type AuthorizationTransport,
  type ValidatedAccount,
} from "./auth-broker.js";
import {
  hostCredentialVault,
  type CredentialVault,
} from "./credential-vault.js";
import { DeliveryError } from "./errors.js";
import {
  decodeSubscriptionAccount,
  subscriptionAccountId,
} from "./subscription-account.js";
import { prepareSubscriptionAuth } from "./subscription-auth.js";

const refusal = (stage = "setup") =>
  new DeliveryError(
    `Separate subscription authorization did not complete at ${stage}. Check browser consent and protected host storage, then retry; production delivery remains disabled.`,
  );
async function fetchBoundedJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new AuthorizationHttpFailure(response.status);
  // Bound untrusted OAuth and JWKS response bodies before parsing.
  const reader = response.body?.getReader();
  if (!reader) throw refusal();
  let bytes = 0;
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 131072) throw refusal();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
  }
}
const openAI: AuthorizationTransport = {
  exchange: (params) =>
    fetchBoundedJson("https://auth.openai.com/api/accounts/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    }),
  signingKeys: async () => {
    const result = await fetchBoundedJson(
      "https://auth.openai.com/.well-known/jwks.json",
    );
    if (!Array.isArray(result.keys) || result.keys.length > 32) throw refusal();
    return result.keys;
  },
};
interface AuthorizationHostAdapters {
  platform: NodeJS.Platform;
  arch: string;
  transport: AuthorizationTransport;
  credentialVault: (directory: string) => CredentialVault;
}
function store(
  account: ValidatedAccount,
  vault: CredentialVault,
  replace = false,
): string {
  const id = subscriptionAccountId(account);
  const encoded = Buffer.from(JSON.stringify(account)).toString("base64");
  vault.write(id, encoded, replace);
  return id;
}

/** Explicit separate setup only. No owner credential files, VM or candidate
 * commands are read or run. Tokens stay in the trusted host and Keychain. */
export async function authorizeSubscriptionAuth(
  directory: string,
  repository: string,
  authority: string,
  announce: (url: string) => void,
  selectedId?: string,
  adapters: AuthorizationHostAdapters = {
    platform: process.platform,
    arch: process.arch,
    transport: openAI,
    credentialVault: hostCredentialVault,
  },
) {
  if (
    !(
      (adapters.platform === "darwin" && adapters.arch === "arm64") ||
      (adapters.platform === "win32" && adapters.arch === "x64")
    )
  )
    throw refusal();
  const registration = prepareSubscriptionAuth(
    directory,
    repository,
    authority,
  );
  const vault = adapters.credentialVault(
    dirname(registration.registrationPath),
  );
  let selected: ValidatedAccount | undefined;
  if (selectedId !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(selectedId)) throw refusal();
    try {
      const encoded = vault.read(selectedId);
      if (!decodeSubscriptionAccount(encoded, selectedId, registration.hostId))
        throw refusal();
      selected = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch {
      throw refusal();
    }
  }
  const broker = new SubscriptionAuthBroker(registration, adapters.transport);
  let callbackUri = "",
    complete = false;
  let accept!: (url: string) => void;
  let fail!: (error: Error) => void;
  const callback = new Promise<string>((resolve, reject) => {
    accept = resolve;
    fail = reject;
  });
  const server = createServer((req, res) => {
    const reject = () => {
      res.writeHead(400, {
        "content-type": "text/plain",
        "cache-control": "no-store",
      });
      res.end("Authorization refused. Return to Developer OS.");
    };
    try {
      const expected = new URL(callbackUri);
      if (
        complete ||
        req.method !== "GET" ||
        !req.url ||
        req.url.length > 16384 ||
        req.headers.host !== expected.host
      )
        return reject();
      const observed = new URL(req.url, callbackUri);
      if (
        observed.origin !== expected.origin ||
        observed.pathname !== "/auth/callback"
      )
        return reject();
      complete = true;
      res.writeHead(200, {
        "content-type": "text/plain",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      res.end(
        "Callback received. Check Developer OS for the verified authorization outcome.",
      );
      accept(observed.href);
    } catch {
      reject();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const timer = setTimeout(() => fail(refusal("callback-timeout")), 300000);
  let stage = "callback-listener";
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw refusal();
    callbackUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const pending = broker.begin(callbackUri, selected);
    announce(pending.authorizationUrl);
    stage = "callback";
    const account = await broker.complete(await callback);
    stage = "keychain-store";
    const accountId = store(account, vault, selected !== undefined);
    return {
      status: "authorized",
      accountId,
      credentialsStored: true,
      storage:
        adapters.platform === "win32"
          ? "Windows CurrentUser DPAPI"
          : "macOS Keychain",
      planUsageAuthorized: account.planUsageAuthorized,
      deliveryEnabled: false,
      nextAction:
        "Qualify the model-only relay, revocation, VM credential exclusion and owner-authorized subscription inference; authentication alone cannot qualify a worker.",
    };
  } catch (error) {
    if (error instanceof AuthorizationFailure) throw error;
    throw refusal(stage);
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
