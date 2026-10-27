# Issue 04 slice 3, tests: the routed session acceptance runner

Base: `main` at `75fd2e7`. 26 October 2026. No inference, no credentials, no
native run.

## What changed

- **`scripts/run-native-routed-acceptance.mjs` (new).** An owner-run runner
  for the plan's slice 3 native check. It drives the real
  `NativePodmanCodingTransport` through one routed lineage: a launch, then an
  explicit resume.
  - **The route.** Each turn gets a `modelRoute` and a real
    `GeneralSessionGateway`. Codex reaches the model only through the session
    relay, and the relay only through the gateway. The lineage keeps one
    delivery and mediation decision. Each turn gets a fresh relay capability
    and its own grant.
  - **The fake provider.** The plan put the capture's fake provider in the VM.
    It sits on the host instead, injected into the gateway, so the relay
    channel and the gateway's checks are on the path too.
    - It sends no network request and ignores the token, which is synthetic.
    - The first request of each turn gets a fixed code-mode script. It adds
      `routed-<turn>.txt` through `tools.apply_patch`, reads it back through
      `tools.exec_command`, and reports a marker that only a successful read
      produces. The script's source never contains the marker.
    - Later launch requests get a five-second `sleep` script until the probe
      has run, at most 24 of them. Then the turn ends with a final message.
  - **The probe.** It runs between model requests, in the live routed launch,
    once Codex has made a request. The relay serves one request at a time, and
    the fake answers at once, so the probe's GET never waits long. This gives
    the routed `relay-listener` and `relay-answers` controls, which the 25
    October runs could only show offline.
  - **Stages,** in order:
    1. fresh pins;
    2. owner record names them;
    3. launch with live probe;
    4. tools ran;
    5. grant revoked;
    6. exact stop;
    7. edit collected;
    8. resume, which must continue the thread with a new capability and pass
       the same tool, grant and stop checks;
    9. resume edit collected.
  - **Report.** It keeps counts and fixed labels only, never request or
    response content. Stages that never ran are `not-run`. Every attempted
    session gets a final exact stop.
  - **Outcomes:** `observed-offline-routed-acceptance`, `failed` (a probe),
    `blocked`, or `uncertain`.
- **`tests/routed-acceptance.test.mjs` (new).** 24 tests, using the real
  gateway and a fake VM whose "Codex" sends the captured 0.161.0 request
  shape. Its code-mode host really runs the provider's scripts, against tools
  over the workspace, so the JavaScript itself is tested.
- **`tests/fresh-build.test.mjs`:** the new runner refuses a stale build
  before any effect.
- **Docs:**
  - `docs/worker-qualification.md` gains "Routed session acceptance", with
    commands for both hosts, outcomes and limits.
  - The plan's slice 3 tests bullet points here.

No `src/` or guest code changed. The coding `policySha256` is unchanged, so
the owner's current coding records (policy `89339099…`) stay valid.

## Evidence

- Written test-first: the tests failed with the runner absent.
- The tests cover:
  - the passing lineage, including the probe after the first request, at
    least one keep-alive, and release well before the cap;
  - a failed probe kept as `failed`;
  - blocking at the right stage for:
    - a record naming other pins, with no turn started;
    - tools that never ran;
    - a stray request;
    - a refused request;
    - a gateway-refused shape;
    - a launch that ends before it can be probed;
    - a non-zero exit;
    - no thread;
    - pins changing during the probe;
    - a grant revoked for another reason, or never revoked;
    - a surviving descendant;
    - an incomplete collection;
    - a lost edit;
    - a resume on a new thread;
    - an interruption;
  - `not-run` stages;
  - an uncertain final stop;
  - the provider's scripts and marker;
  - argument refusal.
- **Mutants:** 19 tried. One check was removed as redundant: provider
  requests equal to the fake's own count. Of the other 18, 16 are killed and
  2 are equivalent.
  - The first round of 16 left 8 survivors. Each of those got a fault, apart
    from the redundant check. Three more mutants followed: the single-thread
    check, the interruption check and the launch release.
  - **Equivalent:** the after-stop `revoked` refusal follows from a `stopped`
    revocation in the real gateway.
  - **Equivalent:** the stage-level interruption check, since an interruption
    already stops the turn through its gates.
- **Checks on Node 24.15.0:**
  - format and typecheck pass;
  - the full suite ran 1,249 tests: 1,240 passed, 4 skipped, 5 failed.
- **The five failures:**
  - Two are the known local SSH-signing passphrase prompts. They also fail on
    unchanged `main`; see #112.
  - The other three are in files this change doesn't touch:
    `podman-platform` (Mac headroom timing) and two `worker-native-coding`
    probe tests. They pass alone, and their files pass whole (173 of 173). So
    they are sensitive to load under `--test-concurrency=4`, not regressions.

## Not covered (native)

- **Not yet run on either host.** The run will show:
  - whether code mode runs the scripts as expected, or yields them back to
    the model;
  - Codex reading a reply ended by closing the connection;
  - `podman unshare nsenter` into a real coding worker;
  - the routed probe against a real relay.
- **No real provider.** A real reply's size, timing and events are for
  slice 5.
- **Route continuity.** The guest still doesn't compare a predecessor's route
  with a resume's. The runner keeps one delivery and decision, but whether the
  guest must enforce that is still the owner's decision (3a receipt).

Production remains disabled.
