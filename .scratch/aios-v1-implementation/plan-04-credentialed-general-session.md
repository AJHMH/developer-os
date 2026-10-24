# Plan: Issue 04's credentialed general session

Status: **approved by the owner on 24 October 2026.** Slice 1 is
[ADR 0002](../../docs/adr/0002-mediated-general-coding-session.md). The
decisions below are settled. No credentials or inference are used before
slice 5.
Date: 24 October 2026.

## What it must deliver

These are the Issue 04 items it closes (`issues/04-isolated-worker-gate.md`):

- **:134–137** "Bind each launch and explicit-session resume to … fresh
  model-only access authority."
- **:143–144** "Complete native general-session usage monitoring, exhaustion
  with work preservation, and fresh restart/re-dispatch authorization
  (remaining 22 scope)."
- **Criterion 4 (:167–168)** "Positive-control canaries prove external
  endpoint/dependency restrictions, model-only credential mediation and
  usage/restart controls for general sessions."

## What exists

**Reused, unchanged in spirit:**
- **Fixed-worker mediation, natively proven on both hosts.**
  - `HostSubscriptionGateway` (`src/subscription-gateway.ts`) holds the
    credential on the host and forwards one fixed request.
  - A VM relay and `RevocableModelGrant` (`src/model-relay.ts`) give the
    worker only a random, revocable capability. The worker never holds a
    credential.
  - The gateway allows exactly one fixed request (`src/inference-contract.ts`)
    on a one-shot, run-ID-bound owner approval.
- **Controlled-only usage controls.**
  - Usage: `codexSubscriptionReader`, `UsageApprovalGate`, the controller's
    coding usage monitor, lapse and interruption records, and
    `approveCodingRestart`.
  - Account binding: `qualifiedDecision` account binding and the endorsement
    tool.
  - Exhaustion is never overridden.

**Missing:**
- The general coding transport has **no network or relay mode**. The
  container runs `--network=none`, `CodingRequest` has no capability field, and
  the guest asserts no network.
- The gateway cannot carry an arbitrary coding turn, only the fixed request.
- **Freshness gaps:** the dispatch recheck reuses a stored usage report for up
  to 60 s, and a mediation decision withdrawn mid-turn is not seen until the
  next launch.
- There is no general-session native canary for endpoints, mediation or usage,
  and no production coding adapter.

## Proposed slices

Each slice is reviewed, tested, published and merged on its own. Slices 1–4
make **no provider request**. Only slice 5 spends subscription usage, and only
under a fresh one-shot owner approval for each run.

### Slice 1 — ADR: mediated general coding session (design only)

`docs/adr/0002-…` records how a live Codex session reaches the model without
ever holding a credential or reaching anything else. It decides:
- **Route.** The pinned Codex CLI talks to a fixed model-provider endpoint
  configured through fixed `-c` arguments in the locked argv. No
  `config.toml` is involved: the guest and the boundary probe refuse it.
  That endpoint is a **VM relay** that holds only the session's revocable
  capability. The relay forwards to the **host gateway**, which holds the
  credential.
- **The general gateway.** A new, separate `GeneralSessionGateway`, so the
  fixed gateway stays untouched. It:
  - allows only the provider's Responses path, with the model pinned;
  - sets size, time and stream bounds;
  - forwards no worker headers, URLs or redirects;
  - never refreshes, retries or falls back to paid access;
  - binds one delivery, one account, one session capability and a deadline;
  - revokes the grant on stop, pause, exhaustion or a changed pin.
- **Container wiring.** Owner decision A below: the relay runs in the
  worker's network namespace.
- **Freshness.**
  - Every dispatch takes a fresh usage observation, with no 60-second reuse.
  - The relay rechecks the mediation decision and usage at each provider
    request, so a withdrawal or exhaustion mid-turn takes effect at the next
    request.
- **What it never does:** carry an owner credential into the VM, broaden the
  fixed gateway, or enable production.

### Slice 2 — The general gateway on the host (no inference)

Build `GeneralSessionGateway` test-first against a fake provider that
implements the Responses contract and streaming.
- **Refusals covered:** wrong path, model or capability; oversize or overtime
  requests; redirects; worker headers; a revoked grant.
- **Usage gates covered:** usage gating at each request, exhaustion stopping
  the stream, and account drift.
- No real provider is contacted, and `inferenceAuthorized` stays `false`.

### Slice 3 — Relay and container wiring (no inference)

- The coding guest gains a model-only mode. The container keeps no general
  network, and the only model route is the relay path from decision A.
- The `CodingRequest` and launch binding carry the session capability and the
  mediation decision. `PinnedCodingRuntime`, the record and the pins bind them.
- The guest's effective-configuration checks and the boundary probe are
  updated. The relay is the only new route; the probe proves that every other
  endpoint, including the npm registry, is still unreachable, and that no
  credential exists in the container.
- **Tests:** in the simulator, and natively offline with a **fake provider in
  the VM**. That shows the route works and is the only one, with no real model.
- **Pins change.** Each host's coding record is re-approved.

### Slice 4 — Usage, exhaustion and restart on the native session (no inference)

- Wire the controller's usage monitor, lapse record and restart approval to
  the native transport.
- **Exhaustion:** revoke the grant, stop the exact session, and collect the
  workspace for preservation. Re-dispatch needs a fresh restart approval.
- **Tests:** a synthetic usage reader in the simulator and in an owner-run
  offline canary (owner decision C) covers low usage needing approval, unknown
  usage, exhaustion mid-turn, a withdrawn decision, and restart refused
  without a fresh approval.

### Slice 5 — Owner-authorized native credentialed qualification (spends usage)

An owner-run runner, run once per host. Each step:

| Step | What happens |
|---|---|
| Usage observation | Read the account and window first, and refuse if unknown or exhausted |
| Owner approval | A fresh one-shot approval naming the run ID and the exact number of turns (decision B), written by the owner |
| Turn 1 | One live coding turn through the mediation path, on a trivial synthetic repository with a fixed prompt |
| Resume | One explicit resume of that thread |
| Positive controls | The probe still passes; a credential canary is not visible; non-model endpoints and the npm registry are refused; a grant used after its stop is refused |
| Usage controls | A synthetic exhaustion stand-in at the gate stops the session and preserves the workspace; restart is refused until a fresh approval is given |
| Evidence | The report keeps usage before and after, every request count, and every refusal |

The criterion 4 evidence is real native observation on both hosts. Production
stays disabled.

## Owner decisions (24 October 2026)

- **A. Route into the container: the fixed worker's proven relay in the
  worker's network namespace.**
  - Guest management starts the relay listening on the container's own
    loopback. The network stays `none`, with no mount and no in-worker binary.
  - The owner first chose a mounted socket with an in-worker forwarder. The
    owner switched once the fixed worker's natively proven namespace relay was
    found.
- **B. Live budget for slice 5:** at most two provider turns per host (launch
  plus resume), four in total. Each has a 3-minute allowance and a fixed
  trivial prompt. A run needing more is refused, not extended.
- **C. Usage policy:** reuse `UsageApprovalGate` unchanged. Low or unknown
  usage requires approval, and exhaustion is never overridden. No new
  threshold is added.
- **D. Model:** pin the fixed worker's model, `gpt-6.1-sol`, and refuse any
  other.

## Risks and how they are contained

- **The credential reaches the worker.** It stays on the host by design. The
  canaries look for it in the container's environment and files, and the
  relay holds only the revocable capability.
- **The model path becomes general egress.** The gateway allows the Responses
  path with a pinned model only, and the probe proves every other endpoint is
  still closed.
- **Runaway usage.** Every dispatch takes a fresh observation, the relay checks
  usage at each request, and the live budget is fixed. Exhaustion revokes,
  stops and preserves the workspace.
- **Scope creep into production.** `DELIVERY_NOT_ENABLED` and
  `productionEnabled: false` stay. Production enablement is the following,
  separate design.

## Estimate

Each of slices 1–4 is about one working session, including review and CI.
Slice 5 is one session per host, plus owner time for the approvals. Codex CLI's
provider configuration (decision A) is the main unknown. Most of that unknown is now
settled: the fixed worker already drives Codex through exactly these
`-c model_providers.*` overrides.
