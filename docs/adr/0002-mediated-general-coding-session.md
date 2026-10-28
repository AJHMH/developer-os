# Mediated general coding session

Date: 2026-10-24
Status: accepted (amended 24 October 2026; see "Amendment: tools and sandbox")

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
- The container stays `--network=none`. It gains no network, mount or binary
  for the route itself. (The amendment below adds one pinned binary, for
  tools.)
- Guest management starts the session's relay inside the worker's network
  namespace, on a fixed loopback port, before Codex is released.
- The relay is part of the coding guest program, so it is covered by the
  coding `policySha256`.
- The locked argv gains fixed provider overrides that point Codex at that port.
  No `config.toml` is involved: the guest and the boundary probe still refuse
  it.
- The session's capability arrives through `env_key` in a variable that is not
  a credential name. The boundary probe's credential checks stay valid.
- **Fixed values (slice 3a):**
  - The relay listens on `127.0.0.1:18091`, clear of the fixed worker's 18081
    and 18082.
  - The provider id is `aios`, and the variable is `AIOS_MODEL_ROUTE`.
  - Codex sends the delivery as `X-AIOS-Delivery`, a fixed `http_headers`
    override.
  - The value in `AIOS_MODEL_ROUTE` is the relay's own random, revocable
    capability for the session, never the gateway's capability. The
    gateway's capability stays on the host.
  - The guest records only the capability's digest, with the delivery and
    the mediation decision, in the launch admission. The container's route
    variable must match that digest.
  - Offline turns keep `workspace-write`, add no overrides, and add no route
    variable.
- The relay accepts only the following, and refuses everything else with an
  empty 403:
  - `POST /v1/responses`;
  - the session's capability and delivery header;
  - a bounded body naming the pinned model;
  - no upgrade, websocket, query string or other method.
- **The channel (slice 3b):**
  - Each routed turn opens one long-lived `podman machine ssh` channel, apart
    from the short management calls. Guest management starts the relay
    inside the worker's network namespace. It records the relay's process
    group and start time before the relay can listen, then the listener's
    own process once the relay is ready. The relay refuses to listen unless
    its network namespace is the worker's, and it holds no credential.
  - Only the request body crosses the channel, as a frame. The host passes it
    to `GeneralSessionGateway.respond` with the gateway's own capability, and
    streams the reply back in bounded frames. The relay writes them to the
    socket as server-sent events, ended by closing the connection.
  - Requests are served one at a time, matching the gateway's single request
    slot. A body must be strict UTF-8 JSON. Unknown methods and malformed
    requests get the same empty 403, except a request line Python reads as
    HTTP/0.9, which gets no reply at all. A gateway refusal before any bytes
    is an empty 403; a failure mid-stream cuts the response.
  - **Release is separate from launch.** Launch starts the container with
    bootstrap still waiting. A new `release` action lets Codex start, and
    the guest refuses it for a routed session unless the relay it recorded
    is still the live process. A poll refuses once that relay has gone.
  - **Fail closed.** A malformed or out-of-order frame, an oversized line,
    or the channel ending loses the relay: the host revokes the gateway and
    stops the exact session. If the channel closes, the relay exits at once,
    and so it does if the host is silent past the response gap. Stop kills
    the recorded relay first, and records that it has ended once its
    processes are gone.
  - A route without a gateway, a gateway without a route, or a gateway
    sharing the relay's capability is refused before any VM effect.

### The gateway

A new `GeneralSessionGateway` is added on the host. **The fixed gateway is not
changed or reused for general turns.**
- **Binding:** it binds one delivery, one host-selected account, one session
  capability and a deadline.
- **Requests:**
  - It forwards only the Responses request body, re-serialized from what it
    inspected and without `client_metadata` (see the amendment).
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
- **Revocation:** the grant is revoked, irreversibly, on stop, pause, a
  changed pin, the deadline, or fresh authority that no longer permits the
  turn (exhausted, approval required, unknown, another account, or a
  withdrawn decision). That last case also ends the turn at once and records
  its reason as a usage interruption.

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
  - **Done in slice 3, step 4.** The coding worker runs its own probe, the
    shared probes plus five more (`docs/worker-qualification.md`):
    - the relay as the only listener;
    - the relay answering with its refusal;
    - binaries mounted read-only;
    - a process with no capabilities, `NoNewPrivs` and seccomp;
    - the workspace and session as the only writable places, apart from
      Podman's private in-memory tmpfs.

    The mode comes from the guest's own record. The shared probe also
    refuses the npm registry, for both workers.
- **Criterion 4.** The evidence will come from the native qualification on
  both hosts, within the live budget above.
- **Separation from the fixed worker.** The fixed worker's gateway, approvals
  and evidence are untouched. The general worker reuses the pattern and the
  relay/grant primitives, never the fixed-worker approvals or evidence.

## Amendment: tools and sandbox (24 October 2026)

An offline capture of Codex 0.161.0 against a fake provider in the Mac VM
found two problems with the route as first decided. The capture is recorded
in `.scratch/aios-v1-implementation/ticket04-request-shape-capture-receipt.md`.
This amendment reopens the earlier "no new binary" line and the locked
argv's `workspace-write` sandbox.

### Context

- **The pinned model is code-mode-only.** Codex's bundled catalog gives
  `gpt-6.1-sol` `tool_mode: "code_mode_only"`. Its only tool for editing and
  running commands is code mode's `exec`, which needs `codex-code-mode-host`
  next to the executable. That host isn't in the container, so every edit and
  command failed closed. Feature flags don't change this.
- **Codex's own sandbox can't start here.** Under `workspace-write`, Codex
  runs commands and edits through bubblewrap. Bubblewrap needs `unshare`,
  which the coding seccomp profile removes along with `setns`. Edits and
  commands failed even with the packaged `bwrap` mounted.

### Decisions

- **The code-mode host is a second pinned binary.**
  - The worker gets `codex-code-mode-host` from the same official package as
    its CLI (`@openai/codex@0.161.0-<platform>`). On linux-arm64 its SHA-256
    is `64efe2950af9d8ac9e9b94b0aac5e41f56307422e34e66a4217aaea0a221fed0`.
  - It is provisioned by the owner beside the CLI in guest management
    storage, as the CLI is.
  - The guest checks its hash, copies it into the session, and bind-mounts
    it read-only at `/codex-code-mode-host`.
- **Its digest is a pin.** A new pin, `codeModeHostSha256`, sits next to
  `cliSha256`. The owner coding admission names it, and a mismatch stops
  coding like any other pin change.
- **The container is the only sandbox.** The locked argv runs Codex with
  `danger-full-access`: `--sandbox` on launch and `-c sandbox_mode=` on
  resume. Every isolation property comes from the hardened container:
  - `--network=none`, a read-only root, no capabilities and
    `no-new-privileges`;
  - the derived seccomp profile, the user namespace and the pids and memory
    limits;
  - the workspace and session as the only writable mounts.

  The boundary probe has to keep proving each of these properties under the
  new mode.
- **Unchanged:**
  - the catalog: no `model_catalog_json` and no `config.toml`;
  - the model's own tool mode;
  - the relay route;
  - the gateway's tool rule: only tools the worker runs itself.
- **Pins.** The coding guest program changes again in the same slice, so the
  admission is re-approved once, for both changes.

### Consequences

- About 67 MB more per host goes into guest management storage, and the
  Windows guest needs the `linux-x64` package's host binary
  (`e87096087c02aa6ab90a5a85031659665aa0bf3ee20c07ca0b8ab701c83fcd5b`).
- **The gateway follows the captured shape.** It admits the
  `additional_tools` item and `reasoning.context: "all_turns"`. Tools in that
  item, and in top-level `tools`, may be worker tools or one level of
  `namespace` groups. A group holds only function and custom tools and
  carries no field beyond its name, description and tools, because the
  provider decides what a group means. The item carries only its type, id,
  role and tools. Hosted tools are never admitted. Tool definitions are held
  to this tool rule, not scanned as conversation content.
- **`client_metadata` never reaches the provider (owner decision).** It
  carries Codex's installation, window, session, thread and turn
  identifiers, and the provider needs none of them to answer a turn. The
  gateway admits it only as an object, then removes it.
- **The forwarded body is the inspected one.** The gateway re-serializes the
  body it parsed rather than forwarding the worker's bytes. The provider then
  can't read a duplicate key that the gateway's parser resolved differently.

### Alternatives rejected

- **A catalog override to `tool_mode: "direct"`.** It worked offline under
  `danger-full-access`, but it adds a generated catalog file to pin and runs
  the model outside the tool mode it is catalogued for.
- **Keeping `workspace-write` with a packaged `bwrap`.** It would mean
  loosening the seccomp profile to allow `unshare` and `setns`, which weakens
  the container that is the actual boundary.

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
