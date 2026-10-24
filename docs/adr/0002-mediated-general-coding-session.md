# Mediated general coding session

Date: 2026-10-24
Status: accepted

## Context

Issue 04 still needs three things for the general coding worker:
- fresh model-only access authority for each launch and explicit resume;
- native usage monitoring, exhaustion with work preservation, and fresh restart
  authorization;
- positive-control canaries for endpoint restriction, model-only credential
  mediation and usage or restart controls (criterion 4).

The general worker is offline by construction today:
- its container runs `--network=none`;
- `CodingRequest` carries no capability;
- its guest asserts there is no network;
- the native transport receipt forbids broadening the fixed-worker gateway to
  it.

The fixed worker (issues 21–25) already proves model-only mediation on both
hosts:
- A **host gateway** (`HostSubscriptionGateway`) holds the credential and sends
  one fixed request on a one-shot, run-bound owner approval.
- A **VM relay**, run by guest management, enters the worker's network
  namespace (`podman unshare nsenter --net=…`) and listens on the container's
  own loopback. Loopback is the only interface `--network=none` leaves.
- Codex reaches the relay through fixed `-c model_providers.<id>.*` overrides:
  - `base_url="http://127.0.0.1:<port>/v1"`;
  - `wire_api="responses"`;
  - `requires_openai_auth=false`;
  - `supports_websockets=false`;
  - `env_key` naming a delivery capability.
- The worker holds only that random, revocable capability (`RevocableModelGrant`).

The owner decided the following on 24 October:
- reuse this proven route, rather than mounting a socket or adding a forwarder
  inside the worker;
- allow at most two live turns per host for the native qualification (launch
  and resume);
- reuse `UsageApprovalGate` unchanged;
- pin the model the fixed worker uses.

## Decisions

### The route

The general coding worker gets a **model-only mode**. It is not a network mode.
- The container stays `--network=none`, with no new mount and no new binary.
- Guest management starts the session's relay inside the worker's network
  namespace, on a fixed loopback port, before Codex is released.
- The relay is part of the coding guest program, so it is covered by the
  coding `policySha256`.
- The locked argv gains fixed provider overrides that point Codex at that port.
  No `config.toml` is involved: the guest and the boundary probe still refuse
  it.
- The session's capability arrives through `env_key` in a variable that is not
  a credential name. The boundary probe's credential checks stay valid.
- The relay accepts only the following, and refuses everything else with an
  empty 403:
  - `POST /v1/responses`;
  - the session's capability and delivery header;
  - a bounded body naming the pinned model;
  - no upgrade, websocket, query string or other method.

### The gateway

A new `GeneralSessionGateway` is added on the host. **The fixed gateway is not
changed or reused for general turns.**
- **Binding:** it binds one delivery, one host-selected account, one session
  capability and a deadline.
- **Requests:**
  - It forwards only the Responses request body.
  - It replaces the worker's headers with its own.
  - It uses the fixed provider origin, with no redirects, refresh, retries or
    paid fallback.
  - Request and response sizes and durations are bounded, and streaming is
    passed through within those bounds.
- **Usage gating:** before each provider request, it re-reads usage through
  `UsageApprovalGate` and checks the mediation decision. It refuses when usage
  is unknown or exhausted, when the account drifts, or when the decision was
  withdrawn. A withdrawal or exhaustion therefore takes effect at the next
  provider request within a turn, not only at the next launch.
- **Revocation:** the grant is revoked, irreversibly, on stop, pause,
  exhaustion, a changed pin, or the deadline.

### Authority and usage

- **Authority binding.** Each launch and explicit resume binds the capability
  and mediation decision through `CodingRequest`, the launch binding,
  `PinnedCodingRuntime` and the owner coding admission. The decision must
  name the same account the gateway selects.
- **Fresh observation.** Every dispatch takes a fresh usage observation. The
  60-second reuse of a stored report in `mayDispatch` is removed for this
  mode.
- **Exhaustion and restart.**
  - Exhaustion revokes the grant, stops the exact session and collects the
    workspace for preservation. The interruption is recorded first.
  - Re-dispatch requires a fresh coding restart approval.
  - Exhaustion is never overridden.
- **Approval levels.** Low or unknown usage requires owner approval through the
  existing `UsageApprovalGate`. No new threshold is added.

### Live inference

- **Qualification runs.** Real provider requests happen only in an owner-run
  native qualification. Each run is gated by a fresh, one-shot approval that
  names the run ID and its turn count, which is at most two per host.
  Historical approvals never authorize a run.
- **Tests.** Every other test uses a fake provider: the simulator, or a fake
  provider in the VM for offline native checks.
- **Production.** `inferenceAuthorized`, `productionEnabled` and
  `DELIVERY_NOT_ENABLED` are unchanged. Production enablement is a separate
  design.

## Consequences

- **Pins.** The coding guest program changes, so each host's owner coding
  admission is re-approved once the route lands.
- **Probe.** The boundary probe gains a positive control for the relay port in
  model-only mode. It keeps proving that every other endpoint is unreachable,
  the npm registry included, and that no credential is present in the
  container.
- **Criterion 4.** The evidence will come from the native qualification on
  both hosts, within the live budget above.
- **Separation from the fixed worker.** The fixed worker's gateway, approvals
  and evidence are untouched. The general worker reuses the pattern and the
  relay/grant primitives, never the fixed-worker approvals or evidence.

## Alternatives rejected

- **A Unix socket bind-mounted into the worker, plus a loopback forwarder.**
  It adds a mount and an in-worker binary to qualify, and the namespace relay
  already provides the same loopback path with native evidence.
- **An internal Podman network whose only address is the relay.** It adds a
  network namespace with routes that would need proving closed, and gains
  nothing over loopback.
- **Extending `HostSubscriptionGateway`.** It deliberately admits one fixed
  request on one-shot approvals, and broadening it would blur the fixed-worker
  evidence.
