# Prepared single-request subscription inference test

Preparation is complete; execution has not been authorized or run.
Inspect `ticket21-inference-plan.json` and the reviewed
`ticket21-inference-test.mjs` before granting this one run.

The fixture sends only “Say exactly: AIOS model-only inference complete” using
`gpt-6.1-sol` to OpenAI's public Responses endpoint. It sets `store:false` and
`stream:true`, as required by the official
[plan inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
The model is a candidate from the documented example; its entitlement is not
assumed. Any HTTP/usage/model failure stops the run without substitution.

Approval must name the current plan's run ID and explicitly accept unknown
remaining subscription usage. It permits one request, no retry, and expires
with the plan after one hour. A 30-second deadline bounds local execution, not
billing; no exact financial cap is claimed. The host holds OAuth tokens only
in Keychain/memory. Alpine receives only the fixed prompt and exact result over
stdin; it has no network, mounts or owner credentials.

After explicit owner approval, the trusted operator can run:

```sh
node .scratch/aios-v1-implementation/ticket21-inference-test.mjs \
  --execute --approve-run <CURRENT_PLAN_RUN_ID> --approve-unknown-usage
```

Do not execute this command based on this document alone. The current request
asks for preparation only. The harness independently requalifies the VM and
checks policy, binding, relay digest, run expiry and credential expiry. It consumes
the one-shot approval outside the candidate before accessing credentials.
A failed run cannot reuse that approval. A VM restart, policy drift or expired
plan requires fresh preparation and a fresh owner decision.

Success requires `response.completed`, no failed/incomplete event, exact output,
revoked host grant and the same result returned through a shut-down isolated
fixture worker. Partial streamed output is failure. Even success remains scoped
to this Alpine fixture: actual Codex worker qualification and ticket 22 remain
blocked. Repository data, tools, MCP and publication authority are excluded.

## Approved execution observation, 11 October

Run `2c477e41-7dc6-47a9-9e0f-fa6429d5a362` was explicitly approved with unknown remaining usage and executed once. The completed stream returned the exact fixture result; the grant was revoked and delivery stayed disabled. [Observation](ticket21-inference-observation.json). Its approval is consumed. Actual Codex worker endpoint mediation remains unqualified; a later live test needs a fresh prepared run and owner approval.
