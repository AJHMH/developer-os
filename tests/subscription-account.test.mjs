import assert from "node:assert/strict";
import test from "node:test";
import {
  accountEligibility,
  decodeSubscriptionAccount,
  subscriptionAccountId,
  validHostRegistration,
} from "../dist/subscription-account.js";

const account = {
  issuer: "https://auth.openai.com",
  clientId: "fixture",
  subject: "owner",
  hostId: "host",
  accessToken: "synthetic",
  scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
  expiresAt: 100001,
  planUsageAuthorized: true,
};
test("one account identity and decoder bind issuer, client, subject and host", () => {
  const id = subscriptionAccountId(account),
    encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
  assert.deepEqual(
    decodeSubscriptionAccount(encode(account), id, "host"),
    account,
  );
  for (const key of ["issuer", "clientId", "subject", "hostId"]) {
    assert.equal(
      decodeSubscriptionAccount(
        encode({ ...account, [key]: "changed" }),
        id,
        "host",
      ),
      undefined,
    );
  }
  assert.equal(decodeSubscriptionAccount("invalid", id, "host"), undefined);
});
test("status and dispatch share exact deadline eligibility and required scopes", () => {
  assert.equal(accountEligibility(account, 70000).eligible, true);
  assert.equal(
    accountEligibility({ ...account, expiresAt: 100000 }, 70000).eligible,
    false,
  );
  assert.equal(accountEligibility(account, 70000, 100001).eligible, false);
  assert.equal(
    accountEligibility({ ...account, scopes: ["resource.invoke"] }, 70000)
      .eligible,
    false,
  );
  assert.equal(
    accountEligibility({ ...account, planUsageAuthorized: false }, 70000)
      .eligible,
    false,
  );
  assert.equal(accountEligibility(account, NaN).eligible, false);
});
test("registration validation is shared without accepting extra authority fields", () => {
  const registration = {
    schema: 1,
    agentName: "Developer OS",
    hostId: "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
  };
  assert.equal(validHostRegistration(registration), true);
  assert.equal(
    validHostRegistration({ ...registration, token: "secret" }),
    false,
  );
  assert.equal(
    validHostRegistration({ ...registration, agentName: "other" }),
    false,
  );
});
