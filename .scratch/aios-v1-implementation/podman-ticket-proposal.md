# Podman qualification ticket proposal

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Status: approved and published

Source: the revised canonical specification and approved runtime/scope decision. The owner approved this breakdown; tickets 18–25 are now published in the implementation tracker. Preserve existing ticket numbers 01–17 and the open parent ticket 04; append the approved 18–25. Existing tickets 15 and 16 still qualify the complete delivery workflow after ticket 14; the new host qualification slices qualify only the worker boundary and therefore do not duplicate them.

## Proposed slices

### 18: Admit a pinned dedicated Windows VM through the controller

Blocked by: 02, 03 (completed).

Deliver a public qualification/status path for the Podman candidate with exact host/provider, engine, VM image/template, worker and policy bindings. Missing or changed bindings, default host shares, management authority exposure or unsupported combinations refuse dispatch. Expand the existing runtime contract alongside the diagnostic adapter rather than perform a speculative broad rewrite. Demonstrate admission/refusal with controlled adapters and live credential-free Windows configuration observations. This admits an offline probe only, not inference or production delivery.

### 19: Run and safely collect an offline delivery canary

Blocked by: 18.

Deliver an offline controller-driven synthetic workspace round trip: admitted ordinary files enter a fresh dedicated VM worker, restricted execution produces an artifact, verified stop precedes safe output collection, and status/evidence records the exact session and bindings. Reject unsafe paths, links/reparse inputs, secrets, Git metadata and concurrent writes. No reusable owner credentials, engine sockets, host mounts or repository scripts on the controller. The demo is synthetic and grants no feature-delivery readiness.

### 20: Prove forbidden access with positive controls

Blocked by: 19.

Deliver reproducible qualification reports for synthetic Windows-host files, controller authority, MCP services, guest management sockets, peer-delivery files and live network services. Controls establish canary existence/reachability before worker denial and remain valid afterward. Include stronger cross-delivery/escape attempts and explicit failed/unknown/not-run results; version drift invalidates results. Do not claim exhaustive escape resistance or use real owner credentials. Demonstrate refusals through the public controller gate.

### 21: Qualify model-only subscription authentication mediation

Blocked by: 18.

Deliver a capability decision through qualification/status: a supported mediation mechanism must separate subscription inference from reusable owner credentials, host MCP/discovery and publication authority. Test credential-free protocol/capability canaries before any authorized live inference. Unsupported or unverifiable mediation reports an actionable blocker; do not copy owner authentication files, buy credits or substitute paid API access. A negative finding completes the investigation but leaves the production gate blocked and requires an owner tradeoff decision; it does not satisfy this ticket's positive qualification criteria.

### 22: Dispatch online inference under independently enforced access policy

Blocked by: 20, 21 (positive authentication qualification required).

Deliver controller dispatch with external model-endpoint enforcement, separate controlled dependency access and the existing subscription allowance approval gate. Demonstrate permitted synthetic traffic and denied host/MCP/arbitrary destinations, including bypass attempts; worker privilege cannot alter the outer policy. Low/unknown usage requires a run-scoped owner grant, exhaustion stops with preserved work, and restart/re-dispatch rechecks. No paid fallback or financial-cap claim. Actual subscription inference remains gated by verified mediation and existing owner authorization.

### 23: Fence and reconcile VM descendants across controller interruption

Blocked by: 19.

Deliver public pause/cancel/restart behavior with independent management verification of stopped descendants, stale-controller fencing, concurrent ownership rejection, orphan reconciliation and exact delivery/session identity. Crash-injection tests demonstrate uncertainty blocks redispatch and safe recovery preserves work and usage. Client termination alone does not establish worker termination. Include live synthetic process evidence beyond the two previously observed descendants.

### 24: Qualify the Windows production worker path

Blocked by: 22, 23.

Deliver the complete Windows worker-boundary qualification report through real controller/CLI integration, combining exact pins, admitted transfer, offline/online controls, authentication, allowance gates and fencing/recovery. Run a synthetic end-to-end worker task and isolated validation with safe result collection. Enable only the qualified host/binding; failures remain blockers. This does not replace later signed publication, approval, merge or full pilot qualification.

### 25: Independently qualify the macOS worker path

Blocked by: 24.

Deliver the same controller/worker contract on macOS 14+ Apple silicon with an explicitly selected, supported VM provider and independent live evidence for every required control. Portability work stays inside this verifiable host slice. Missing macOS infrastructure reports blocked/not-run and keeps execution disabled; Windows evidence is not inherited. Existing ticket 16 remains the later complete-controller delivery qualification.

## Parent and downstream handling

Ticket 04 remains open and unmodified by ticket publication. Its completion requires positive applicable qualification results from these slices; resolving an investigation with a blocker does not complete the parent. Existing ticket 05 remains blocked by 04, and the pilot remains blocked by complete Windows and macOS delivery qualification (15, 16). No dependency points from 18–25 back to 04, avoiding a parent/child cycle.

After approval, publish one ready-for-agent file per slice, update the ticket index with these blocking edges and the superseding canonical contract, and preserve the historical parent text and evidence. Readiness describes specified work, not live host qualification.
