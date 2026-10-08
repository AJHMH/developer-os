# 18: Admit a pinned dedicated Windows VM through the controller

**What to build:** Deliver a public qualification/status path for the Podman candidate with exact host/provider, engine, VM image/template, worker and policy bindings. Missing or changed bindings, default host shares, management authority exposure or unsupported combinations refuse dispatch. Expand the existing runtime contract alongside the diagnostic adapter rather than perform a speculative broad rewrite. Demonstrate admission/refusal with controlled adapters and live credential-free Windows configuration observations. This admits an offline probe only, not inference or production delivery.

**Blocked by:** 02, 03 (completed).

**Status:** completed

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] The public qualification/status contract records exact host/provider, engine, VM image/template, worker and effective policy bindings using controlled and live credential-free observations.
- [x] Missing or changed bindings, default shares, exposed management authority and unsupported configurations refuse dispatch without fallback.
- [x] Only an admitted offline probe is permitted; production delivery and inference remain blocked.

## Comments

Implemented the public Podman qualification/status path alongside the retained Docker diagnostic adapter. Controlled observations demonstrate complete matching bindings and offline-only admission; changed/missing pins, unsafe effective controls and candidate-controlled policy refuse admission. Native read-only Windows observations record Windows x64 build 26300, Hyper-V candidate name and responding Podman engine 6.0.2. Stored empty shares/rootless mode are explicitly configuration intent, not effective enforcement. Image/template/worker provenance, dedication and effective worker controls remain unknown; the real candidate is refused. No VM was created/started, credentials copied or inference dispatched by this slice. See [live projected evidence](../ticket18-live-observation.json).

Typechecking, formatting and all 49 tests passed with host filesystem permissions. An initial sandbox suite attempt could not execute existing Git/junction tests; no checks were weakened. CodeRabbit 0.7.6 completed two owner-approved source reviews with zero findings, including the final configuration-intent distinction. Implementation is complete; live offline admission and production qualification are not. Ticket 04 remains open, with subsequent slices providing the enforcement driver and remaining qualification.
