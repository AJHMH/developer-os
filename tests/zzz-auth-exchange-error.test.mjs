// The provider's OAuth error code on a refused sign-in request. The name sorts
// after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthorizationHttpFailure,
  SubscriptionAuthBroker,
} from "../dist/auth-broker.js";
import { openAI } from "../dist/auth-host.js";

// A broker whose token request is refused with `failure`.
async function refusedWith(failure) {
  const broker = new SubscriptionAuthBroker(
    {
      hostId: "urn:uuid:12345678-1234-1234-1234-123456789abc",
      agentName: "Developer OS",
    },
    {
      exchange: async () => {
        throw failure;
      },
      signingKeys: async () =>
        assert.fail("a refused exchange fetches no keys"),
    },
  );
  const attempt = broker.begin("http://127.0.0.1:1455/auth/callback");
  const callback = new URL(attempt.callbackUri);
  callback.searchParams.set(
    "state",
    new URL(attempt.authorizationUrl).searchParams.get("state"),
  );
  callback.searchParams.set("code", "synthetic-code");
  callback.searchParams.set("client_id", "oaiapp_fixture");
  return broker.complete(callback.href).then(
    () => assert.fail("a refused exchange cannot authorize"),
    (error) => error.message,
  );
}

test("a refused token request names the provider's standard OAuth error code", async () => {
  assert.match(
    await refusedWith(new AuthorizationHttpFailure(400, "invalid_grant")),
    /at token-exchange \(HTTP 400, invalid_grant\);/,
  );
});

test("an error code outside the OAuth list is reported only as unlisted", async () => {
  const message = await refusedWith(
    new AuthorizationHttpFailure(400, "synthetic-private-detail"),
  );
  assert.match(message, /at token-exchange \(HTTP 400, unlisted\);/);
  assert.doesNotMatch(message, /synthetic-private-detail/);
  assert.match(
    await refusedWith(new AuthorizationHttpFailure(400)),
    /at token-exchange \(HTTP 400\);/,
  );
});

test("the host transport keeps only the error field of a refused reply", async (t) => {
  const replies = [
    [
      JSON.stringify({ error: "invalid_target", error_description: "secret" }),
      "invalid_target",
    ],
    [JSON.stringify({ error: { nested: "secret" } }), "unlisted"],
    [JSON.stringify({ error_description: "secret" }), undefined],
    ["not json secret", undefined],
    ["x".repeat(131073), undefined],
  ];
  for (const [body, code] of replies) {
    t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(body, { status: 400 }),
    );
    const error = await openAI.exchange({ code: "synthetic-code" }).then(
      () => assert.fail("a refused reply cannot return tokens"),
      (error) => error,
    );
    assert.ok(error instanceof AuthorizationHttpFailure);
    assert.equal(error.status, 400);
    assert.equal(error.code, code);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /secret/);
    t.mock.restoreAll();
  }
});
