import { createHash } from "node:crypto";
import { macKeychainStore } from "./keychain-store.js";
import { createServer } from "node:http";
import { dirname } from "node:path";
import {
  SubscriptionAuthBroker,
  type AuthorizationTransport,
  type ValidatedAccount,
} from "./auth-broker.js";
import { prepareSubscriptionAuth } from "./subscription-auth.js";
import { DeliveryError } from "./controller.js";

const refusal = () =>
  new DeliveryError(
    "Separate subscription authorization did not complete. Check browser consent and macOS Keychain access, then retry; production delivery remains disabled.",
  );
async function fetchBoundedJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw refusal();
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
function store(
  account: ValidatedAccount,
  vault: ReturnType<typeof macKeychainStore>,
  replace = false,
): string {
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        account.issuer,
        account.clientId,
        account.subject,
        account.hostId,
      ]),
    )
    .digest("hex");
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
) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw refusal();
  const registration = prepareSubscriptionAuth(
    directory,
    repository,
    authority,
  );
  const vault = macKeychainStore(dirname(registration.registrationPath));
  let selected: ValidatedAccount | undefined;
  if (selectedId !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(selectedId)) throw refusal();
    try {
      selected = JSON.parse(
        Buffer.from(vault.read(selectedId), "base64").toString("utf8"),
      );
      if (
        !selected ||
        selected.issuer !== "https://auth.openai.com" ||
        selected.hostId !== registration.hostId ||
        typeof selected.subject !== "string" ||
        typeof selected.clientId !== "string" ||
        createHash("sha256")
          .update(
            JSON.stringify([
              selected.issuer,
              selected.clientId,
              selected.subject,
              selected.hostId,
            ]),
          )
          .digest("hex") !== selectedId
      )
        throw refusal();
    } catch {
      throw refusal();
    }
  }
  const broker = new SubscriptionAuthBroker(registration, openAI);
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
  const timer = setTimeout(() => fail(refusal()), 300000);
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
    const account = await broker.complete(await callback);
    const accountId = store(account, vault, selected !== undefined);
    return {
      status: "authorized",
      accountId,
      credentialsStored: true,
      storage: "macOS Keychain",
      planUsageAuthorized: account.planUsageAuthorized,
      deliveryEnabled: false,
      nextAction:
        "Qualify the model-only relay, revocation, VM credential exclusion and owner-authorized subscription inference; authentication alone cannot qualify a worker.",
    };
  } catch {
    throw refusal();
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
