# Issue 04 slice 3, step 3a: the model route binding

Base: `main` at `1452bd5`. 25 October 2026. No inference, no credentials, no
native run.

## What changed

A coding request may now carry a **model route** (ADR 0002, `CONTEXT.md`):
`{deliveryId, capability, decisionSha256}`. The capability is the session
relay's own random value. Nothing creates a route yet: the relay channel is
step 3b, and slice 4 wires usage. Offline turns are unchanged.

- **One locked argv.** `lockedCodingArgv(threadId, route?)` in
  `src/feature-candidate.ts` replaces three copies: the controller's, the host
  transport's check and the guest's check. The guest's Python `locked()`
  mirrors it, taking the port, variable and model from the same TypeScript
  constants.
  - **Offline:** exactly the earlier `workspace-write` argv.
  - **Routed:** `danger-full-access`, plus fixed `-c` overrides:
    - `model_provider="aios"`;
    - `name`;
    - `base_url="http://127.0.0.1:18091/v1"`;
    - `env_key="AIOS_MODEL_ROUTE"`;
    - `wire_api="responses"`;
    - `requires_openai_auth=false`;
    - `supports_websockets=false`;
    - `http_headers.X-AIOS-Delivery`;
    - `model="gpt-6.1-sol"`.

    It uses no config file, and the capability never appears on the command
    line.
- **Host transport.** It refuses a malformed route before any VM effect,
  refuses argv that doesn't match the route, and binds the route into the
  launch payload.
- **Runtime.** `PinnedCodingRuntime` binds the route into its launch digest
  and hands the transport a copy. A caller that changes the route's
  capability or decision after admission is refused or ignored.
- **The prompt slot.** The host and the guest both refuse a prompt that
  starts with `-`. Codex would otherwise read such a prompt as an option,
  for example `-cmodel="other"`, which could add an override or switch the
  model. The controller always sends JSON, which starts with `{`, so only a
  direct transport caller could have done this.
- **Guest.**
  - It validates the route independently.
  - It records `{deliveryId, decisionSha256, capabilitySha256}` in the
    launch admission, which the host's launch must match.
  - It sets `AIOS_MODEL_ROUTE` on the container only for a routed turn.
  - The effective-environment check admits that one variable only, and only
    when its value matches the recorded digest.

## Evidence

- **New tests.** `tests/model-route.test.mjs` pins the exact argv for an
  offline and a routed launch and resume, and route validity. The simulator
  tests in `tests/worker-native-coding.test.mjs` cover:
  - a routed launch: the overrides are in the command, and
    `AIOS_MODEL_ROUTE` is the only added variable;
  - an offline launch with no route variable;
  - refusals before any worker exists:
    - routed argv without a route;
    - a route with the offline argv;
    - a malformed route;
    - a route whose delivery differs from its argv;
  - a host-only refusal of a malformed route, paired with the routed argv so
    only the route check can refuse it;
  - a guest-only refusal of a route corrupted after the host;
  - a route variable that differs from the admitted digest, before start;
  - the guest's own route-versus-argv check, after the host: the route is
    removed from routed argv;
  - an option in the prompt slot, refused by the host and by the guest;
  - a route changed in the runtime during pin inspection, and a caller's
    route object changed after admission;
  - array-typed route fields.

  The guest's Python `locked()` is extracted from the transported program
  and compared token by token with `lockedCodingArgv`. The comparison covers
  offline and routed, launch and resume.
- **Full local suite: 1,167 tests, 1,163 pass.** It ran with the Mac
  settings from `ticket04-gateway-shape-receipt.md`. The one failure was a
  load-sensitive 5-second Python check in `tests/podman-platform.test.mjs`
  ("generated native management freezes direct wait failures…"), which
  passed alone in 179 ms.
- **Factory coverage gate (`f78ebdb`, base `1452bd5`): no verdict.** Two
  runs on this Mac:

  | Run | Unit tests | Head instrumentation | Base instrumentation |
  |---|---|---|---|
  | 1 | failed on test results | failed on test results | not reached |
  | 2 | passed, 215 s | passed, 237.6 s | failed on test results (`main`, not this change) |

  Every test stage now runs within a few seconds of the 240 s limit on this
  Mac. At that load, the 5-second Python spawn checks fail at random. Those
  are test deadlines, so I left them unchanged. CI's Factory coverage check
  is the verdict for this change.
- **Mutants: 15 tried, 15 killed.** The mutants:
  - the guest or host skips route validation;
  - the guest skips the capability-digest check;
  - no route variable is set;
  - the guest or the TypeScript helper keeps `workspace-write`;
  - the guest drops the delivery header;
  - the host drops the route from the payload;
  - the TypeScript helper stops checking the capability;
  - the guest's resume puts the overrides after the thread;
  - the guest or host allows an option prompt;
  - the runtime omits the route from its binding;
  - the runtime shares the caller's route object;
  - route validation accepts non-strings.

  Two of my own tests at first passed for the wrong reason. In those cases
  the argv check, not the route check, refused the request. Pairing each one
  with the routed argv fixed it.

## Review

An independent review found:
- **one medium issue:** the route was missing from the runtime's launch
  binding;
- **one older weakness that routing makes worse:** the prompt slot could
  carry options;
- **one low issue:** array-typed route fields were accepted;
- **test gaps:** the guest's resume argv and its own route-versus-argv check
  were not exercised.

All of these were fixed before publication.

## Open (owner decision)

**Route continuity across resume.** The guest doesn't compare a
predecessor's route with the resuming turn's route. A routed thread could be
resumed offline or under another delivery, and an offline thread could be
resumed routed. A fresh capability per turn is intended. Whether the
delivery and decision must stay the same across a lineage isn't specified
yet, and should be decided before slice 4 wires routing.

## Not covered
- **The relay channel, the `release` action and the boundary probe's relay
  control.** Those are step 3b and step 4.
