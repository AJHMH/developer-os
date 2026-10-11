# 22: Dispatch online inference under independently enforced access policy

**What to build:** Deliver controller dispatch with external model-endpoint enforcement, separate controlled dependency access and the existing subscription allowance approval gate. Demonstrate permitted synthetic traffic and denied host/MCP/arbitrary destinations, including bypass attempts; worker privilege cannot alter the outer policy. Low/unknown usage requires a run-scoped owner grant, exhaustion stops with preserved work, and restart/re-dispatch rechecks. No paid fallback or financial-cap claim. Actual subscription inference remains gated by verified mediation and existing owner authorization.

**Blocked by:** 20, 21 (the pinned macOS fixture has a positive public decision; broader runtime qualification remains required).

**Status:** ready-for-human

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] Model endpoints are enforced outside worker authority; separate dependency access and synthetic permitted/denied traffic demonstrate bypass resistance.
- [ ] At 20% or less remaining in any allowance, or unknown usage, dispatch requires a delivery/account/window/run-scoped owner grant; exhaustion stops and preserves work, with foreground monitoring and fresh restart/re-dispatch checks.
- [x] Only positively qualified authentication permits inference; no paid fallback, purchase, automatic recharge or exact financial-cap claim is introduced.

## Ticket 21 positive fixture evidence (earlier milestone)

The following milestone is superseded by the public dependency update below.

The exact macOS actual-Codex subscription gateway run passed; see ticket 21 and
`../ticket21-gateway-inference-observation.json`. Authentication remains a blocking
dependency because the positive capability decision is not yet exposed through
trusted public qualification/status. The consumed fixture grant cannot authorize
online dispatch. Production gates and this ticket's acceptance remain open.

## Public authentication dependency update (11 October)

Ticket 21 now exposes the trusted positive decision for its exact macOS fixed
Codex request through public qualification/status. See
`../ticket21-public-capability-observation.json`. That scoped dependency is
satisfied; the consumed historical grant authorizes no new inference. This
ticket's general dispatch, usage and dependency-policy acceptance remains open,
and production delivery remains disabled.


## Ticket 22 implementation and synthetic qualification (11 October)

The public controller `onlineCanary` and CLI `online-canary` path now require
exclusive stopped ownership, fresh trusted macOS admission, the ticket 21
positive capability decision, current account/window usage and a trusted access
runtime. It advances the delivery fence, rechecks authority and usage before each
model/dependency capability, checks again during the foreground run, then revokes
and verifies shutdown before recording output. Failed or uncertain shutdowns keep
the delivery blocked and preserve the original request. Restart/re-dispatch uses
a new usage check and grant.

The host-only network policy gives the model and dependency distinct one-use
tokens and fixed routes. The worker has no network; the separate relay accepts
only the fixed method, path, headers and body, and refuses MCP, other hosts,
redirects, tunnels, upgrades, wrong capability, replay and malformed requests.
Optional dependency access is a separate owner-controlled npm tarball pin with
exact path, size and digest; HTTPS redirects, altered bytes, installs, extraction
and host scripts are refused. Worker privilege cannot change the outer rule.

Usage at 20% or less and unknown usage require a fresh explicit owner grant bound
to the delivery's account/window and consumed by one operation. Exhaustion
revokes the active run. Public polling and recovery preserve the request and
require fresh checks before another dispatch. A separate inference plan captures
the fixed request, account, host, VM/policy/source hashes and one-run limits;
controller tests verify that only the exact approved unexpired plan reaches an
inference-capable adapter. Approval consumption rechecks plan expiry and
integrity inside the dispatch transaction, so asynchronous qualification cannot
carry an expired approval through to execution. No live inference was run.

Fresh native evidence at `../ticket22-native-observation.json` verifies the
controller canary against the current source/policy hash, trusted ticket 21
qualification and unchanged VM binding. It sends only fixed model and dependency
fixture traffic to VM-local synthetic services with a stable synthetic high-
remaining usage report; shutdown observed zero remaining processes. No
subscription credential, provider request or public registry request was used.
Public-controller tests cover approval, denied routes, replay, usage-window and
account drift, exhaustion, foreground stop, uncertain recovery, re-dispatch and
exact-plan refusal/consumption, including expiry during asynchronous qualification.
All 136 tests pass; typecheck, formatting and `git diff --check` pass. Spec and
Standards review found no remaining issues. Production and
live readiness remain false. Any future live inference requires a separately
prepared exact plan and the owner's approval of that plan.
