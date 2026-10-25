# Ticket 04 receipt: general session gateway (credentialed slice 2)

Date: 24 October 2026. Branch `codex/issue04-general-session-gateway`.
Plan: `plan-04-credentialed-general-session.md`.
Design: [ADR 0002](../../docs/adr/0002-mediated-general-coding-session.md),
accepted by the owner on 24 October 2026; this branch marks it accepted.

This slice involves no provider request, credential or inference.
`inferenceAuthorized`, `productionEnabled` and `DELIVERY_NOT_ENABLED` are
unchanged. The fixed-worker `HostSubscriptionGateway` is unchanged.

## What changed

`src/general-session-gateway.ts` adds `GeneralSessionGateway`, the host side
of a mediated general coding session.

- **The session grant.** One delivery, one coding session, one host-selected
  account and a deadline (at most 30 minutes), with a request budget (at most
  512). It is validated when the gateway is built. The worker receives only
  the gateway's random 32-byte capability, which is checked in constant time.
- **Before any credential access**, each request is checked for:
  - the capability, the delivery and an unrevoked, unexpired grant;
  - the request budget, and one request in flight at a time;
  - a request body within its size limit (4 MiB) and of the right shape.
- **The request body:**
  - **Fields:** only the 12 fields a Codex Responses turn uses are allowed.
    Others are refused by name, never by value. That includes
    `previous_response_id`, `background`, `service_tier`, output limits and
    metadata.
  - **Model and streaming:** the model must be `gpt-6.1-sol`, and
    `stream: true` is required.
  - **Storage:** `store: false` is required, so the provider keeps nothing
    between requests.
  - **Include and reasoning:** `include` may hold only
    `reasoning.encrypted_content`. `reasoning` may hold only `effort`
    (minimal to high) and `summary`.
  - **Tools:** only the worker's own `function`, `custom` and `local_shell`
    tools are allowed, and `tool_choice` cannot name a hosted tool.
  - **Replayed items:** only message, reasoning and tool-call or tool-output
    items are allowed. Nothing anywhere in them may carry a file id, file URL,
    file data, an item reference, a file or audio input, or an image that is
    not a `data:image/` URL. So the provider cannot be pointed at remote URLs,
    files or other stored items.
- **Fresh authority for every request.** It is awaited after the slot is
  reserved and before the account is touched.
  - Anything but `permitted` revokes the grant: `approval-required`,
    `unknown`, `exhausted` or `withdrawn`.
  - A revocation or expiry during that wait is honoured.
  - The account is then checked again: same id and host, plan usage
    authorized, scopes present, and the token valid past the request's
    deadline.
- **The provider request.**
  - It starts at once, under the authority just taken. The call resolves
    when the first bytes arrive.
  - It goes to the fixed origin, carrying exactly the inspected body and only
    host headers, with redirects refused and no retries or refresh.
  - The stream is bounded at 16 MiB per response and 5 minutes per request.
  - Revocation aborts it mid-stream.
  - Draining, failing or closing the stream early frees the slot and closes
    the provider request.
- **Revocation** is irreversible and typed: fresh authority, expired, account,
  response bound, stopped, paused, pin changed.
- **The observation** holds counts and fixed labels only: refusal reasons;
  the names of refused fields, tools and items; and provider statuses.
- **Docs:** `CONTEXT.md` defines **General session gateway**.

## Evidence

- `tests/general-session-gateway.test.mjs`: 62 tests over a fake provider,
  account, authority and clock.
  - **The passing path:** the body arrives unchanged with only the host token,
    and the observation holds no token or content.
  - **Refusals before credential access:** grant validation, and 27 refusal
    cases, each refused before authority, account or provider.
  - **Admitted replay:** a full set of replayed items is admitted unchanged.
  - **Revocation:** fresh authority in each non-permitted state revokes
    irreversibly, and a withdrawal mid-session ends the session at the next
    request.
  - **Account:** five account failures each revoke.
  - **Timing and timeouts:**
    - the request budget and grant expiry;
    - expiry, or revocation, during the authority wait;
    - one request in flight at a time;
    - the provider starting at once;
    - a timeout labelled `timeout`.
  - **Streams:**
    - an early close freeing the slot and closing the provider;
    - revocation mid-stream aborting the provider's signal;
    - the response bound.
  - **Provider and adapter:** a provider refusal is recorded once, never
    retried, and the same gateway serves the next request. The adapter's
    fixed origin, method, `redirect: "error"`, headers and body are checked,
    and a non-OK response becomes a typed refusal.
- **Mutants:** 31 mutants were killed. They covered every guard: capability,
  delivery, revocation, expiry, budget, concurrency, model, stream, store,
  include, effort, fields, tools, tool choice, item types, file keys, image
  URLs, authority, account, the revocation and expiry rechecks, the response
  bound, the stream's revocation check, slot release, the timeout label, eager
  start, and the adapter's redirect refusal. Two first-attempt mutants did not
  compile and one was ineffective; each was redone until it compiled and was
  caught.
- **Checks on Node 24.22.1:**
  - formatting and typecheck pass;
  - the full suite under c8 ran 1,112 tests: 1,108 passed, 4 skipped, 0
    failed.
- **Coverage, by the Factory's own `measure-coverage` at `f78ebdb`,** against
  `main` at `67a217f`: it passes.
  - The new `src/general-session-gateway.ts` has 516 of 516 changed lines and
    162 of 162 changed branches covered.
  - Global lines went from 21,148 of 21,713 to 21,664 of 22,229, and global
    branches from 5,747 of 6,193 to 5,909 of 6,355. Both percentages rose.
  - The first CI run failed only because global branch coverage fell by
    0.02 points (135 of 147 branches covered). Ten tests added afterwards
    cover the rest: a tool that is not an object, a tool choice without a
    name, input that is not a list or nested past the depth bound, plain-text
    input, an empty response, reading a closed stream, a provider failure
    mid-stream, a revocation while the provider is waiting, and a chunk that
    arrives after the time bound.
- **Review:** the Standards and Spec reviews ran in parallel.
  - **Fixed — security holes the Spec review found:**
    - unchecked `input` items could have pointed the provider at remote
      images or files, file ids or item references;
    - `store`, `include`, `tool_choice` and `reasoning` were not pinned.
  - **Fixed — correctness:**
    - the provider request started lazily, so authority could be minutes
      stale and an unread stream leaked the slot;
    - expiry during the authority wait was labelled as an account refusal;
    - timeouts were labelled as revocations.
  - **Fixed — standards and tests:**
    - message-string refusal matching, now a `GeneralSessionRefusal` class;
    - untyped revocation reasons;
    - a duplicated UUID pattern;
    - the "session grant" term;
    - the ADR status format;
    - two tests that passed for the wrong reason.

## Open

- **Codex's real request shape.** The allowlists reflect Codex's documented
  Responses usage, not a captured request from the pinned 0.161.0. Slice 3's
  offline native check, with a fake provider in the VM, will capture the
  real field, item and tool names without inference. A refusal names what
  was refused, so any gap is visible and fixed there, before slice 5.
- **Request path and headers.** The worker's path and headers never reach
  this gateway. The slice 3 relay must refuse every path but
  `POST /v1/responses` and drop worker headers.
- **Exhaustion, pause and pin changes** reach the gateway as
  `revoke(reason)` calls. Slice 4 wires them.

Production remains disabled.
