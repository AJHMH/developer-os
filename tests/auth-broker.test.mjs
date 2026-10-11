import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { SubscriptionAuthBroker } from "../dist/auth-broker.js";
const hostId = "urn:uuid:12345678-1234-1234-1234-123456789abc";
function fixture(options = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "fixture",
    alg: "RS256",
    use: "sig",
  };
  const exchanges = [];
  const broker = new SubscriptionAuthBroker(
    { hostId, agentName: "Developer OS" },
    {
      exchange: async (params) => {
        exchanges.push(params);
        if (options.exchangeFailure)
          throw new Error("synthetic-private-provider-detail");
        const encode = (x) =>
          Buffer.from(JSON.stringify(x)).toString("base64url");
        const payload = encode({
          iss: "https://auth.openai.com",
          aud: "oaiapp_fixture",
          sub: "owner",
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce: new URL(attempt.authorizationUrl).searchParams.get("nonce"),
          ...options.claims,
        });
        const data = encode({ alg: "RS256", kid: "fixture" }) + "." + payload;
        return {
          id_token:
            data +
            "." +
            (options.badSignature
              ? Buffer.alloc(256).toString("base64url")
              : sign("RSA-SHA256", Buffer.from(data), privateKey).toString(
                  "base64url",
                )),
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope:
            options.scope ??
            "openid resource.invoke chatgpt.tokens.use.direct offline_access",
        };
      },
      signingKeys: async () => [jwk],
    },
  );
  const attempt = broker.begin(
    "http://127.0.0.1:1455/auth/callback",
    options.account,
  );
  const callback = new URL(attempt.callbackUri);
  callback.searchParams.set(
    "state",
    new URL(attempt.authorizationUrl).searchParams.get("state"),
  );
  callback.searchParams.set("code", "synthetic-code");
  callback.searchParams.set("client_id", "oaiapp_fixture");
  return { broker, attempt, callback, exchanges };
}
test("host authorization binds issued client, exact callback, nonce and PKCE before returning validated credentials", async () => {
  const f = fixture();
  const auth = new URL(f.attempt.authorizationUrl);
  assert.equal(auth.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(auth.searchParams.get("ext_agent_host_id"), hostId);
  const result = await f.broker.complete(f.callback.href);
  assert.equal(result.subject, "owner");
  assert.equal(result.clientId, "oaiapp_fixture");
  assert.equal(result.planUsageAuthorized, true);
  assert.equal(f.exchanges[0].redirect_uri, f.attempt.callbackUri);
  assert.equal(
    createHash("sha256")
      .update(f.exchanges[0].code_verifier)
      .digest("base64url"),
    auth.searchParams.get("code_challenge"),
  );
  await assert.rejects(
    f.broker.complete(f.callback.href),
    /fresh authorization/,
  );
});

test("returning authorization retains issued client and refuses replacement by another verified identity", async () => {
  const f = fixture({
    account: {
      clientId: "oaiapp_fixture",
      subject: "different-owner",
      idToken: "synthetic-prior-id",
    },
  });
  const auth = new URL(f.attempt.authorizationUrl);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_fixture");
  assert.equal(auth.searchParams.has("agent_name_hint"), false);
  f.callback.searchParams.delete("client_id");
  await assert.rejects(
    f.broker.complete(f.callback.href),
    /fresh authorization/,
  );
});
for (const [name, claims] of Object.entries({
  issuer: { iss: "https://other.invalid" },
  audience: { aud: "oaiapp_other" },
  nonce: { nonce: "wrong" },
  expiry: { exp: 1 },
  notBefore: { nbf: 4102444800 },
})) {
  test(`authorization refuses a signed token with invalid ${name}`, async () => {
    const f = fixture({ claims });
    await assert.rejects(
      f.broker.complete(f.callback.href),
      new RegExp(`id-token-${name};`),
    );
  });
}
for (const mutation of ["state", "duplicate", "denied", "redirect", "client"]) {
  test(`authorization refuses ${mutation} callback before any token exchange`, async () => {
    const f = fixture();
    if (mutation === "state") f.callback.searchParams.set("state", "wrong");
    if (mutation === "duplicate")
      f.callback.searchParams.append("code", "other");
    if (mutation === "denied")
      f.callback.searchParams.set("error", "access_denied");
    if (mutation === "redirect") f.callback.port = "1456";
    if (mutation === "client")
      f.callback.searchParams.set("client_id", "dynamic_agent_client");
    await assert.rejects(
      f.broker.complete(f.callback.href),
      /fresh authorization/,
    );
    assert.equal(f.exchanges.length, 0);
  });
}
test("identity-only consent returns an explicit plan usage refusal", async () => {
  const f = fixture({ scope: "openid profile email" });
  assert.equal(
    (await f.broker.complete(f.callback.href)).planUsageAuthorized,
    false,
  );
});

test("authorization rejects a forged signature without disclosing exchanged credentials", async () => {
  const f = fixture({ badSignature: true });
  await assert.rejects(
    f.broker.complete(f.callback.href),
    (error) =>
      !String(error).includes("synthetic-access") &&
      /fresh authorization/.test(String(error)),
  );
});
test("returning account accepts its exact identity without exposing tokens in browser hints", async () => {
  const f = fixture({
    account: {
      clientId: "oaiapp_fixture",
      subject: "owner",
      idToken: "synthetic-prior-id",
    },
  });
  assert.equal(
    new URL(f.attempt.authorizationUrl).searchParams.has("id_token_hint"),
    false,
  );
  f.callback.searchParams.delete("client_id");
  assert.equal((await f.broker.complete(f.callback.href)).subject, "owner");
});

test("authorization reports a safe failure stage without provider credential details", async () => {
  const f = fixture({ exchangeFailure: true });
  await assert.rejects(
    f.broker.complete(f.callback.href),
    (error) =>
      /token-exchange/.test(String(error)) &&
      !String(error).includes("synthetic-private-provider-detail"),
  );
});

test("authorization accepts its issued client as a singleton audience array", async () => {
  const f = fixture({
    claims: { aud: ["oaiapp_fixture"], azp: "oaiapp_fixture" },
  });
  assert.equal(
    (await f.broker.complete(f.callback.href)).clientId,
    "oaiapp_fixture",
  );
});
for (const claims of [
  { aud: [] },
  { aud: ["oaiapp_other"] },
  { aud: ["oaiapp_fixture", "oaiapp_other"] },
  { aud: ["oaiapp_fixture", "oaiapp_fixture"] },
  { aud: ["oaiapp_fixture"], azp: "oaiapp_other" },
  { aud: "oaiapp_fixture", azp: "oaiapp_other" },
]) {
  test(`authorization refuses an untrusted audience or authorized party ${JSON.stringify(claims)}`, async () => {
    const f = fixture({ claims });
    await assert.rejects(
      f.broker.complete(f.callback.href),
      /id-token-audience;/,
    );
  });
}
