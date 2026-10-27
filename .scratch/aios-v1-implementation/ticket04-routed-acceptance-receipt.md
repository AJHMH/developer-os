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

## First native run on macOS, and the order correction (26 October 2026)

After PR #119 merged at `726e4b6`, the owner ran the routed acceptance on
`aios-macos-noshare`. It used a clean, freshly built `main` and the existing
coding record (policy `89339099…`). The report is
`macos/ticket04-routed-acceptance-20261026-222117-failed.json` (SHA-256
`b21dae22…`), outcome `failed`.

**Every stage passed,** in about 58 seconds:
- **Route and tools, natively:** code mode ran the provider's scripts as
  captured.
  - `apply_patch` and `exec_command` worked through the relay and the gateway
    on both turns, and the marker reached the provider.
  - There were no `unexpected` requests and no gateway refusals: 5 requests on
    the launch, with 3 keep-alives, and 2 on the resume.
- **Grants:** each was revoked as `stopped` with its turn, and a later use
  was refused as `revoked`.
- **Threads:** both turns exited 0 on one thread, and the resume continued it
  with a fresh relay capability.
- **Stops and collection:** the exact stop left 0 processes, the probe's
  descendant included. Each edit was collected.
- **The routed relay controls passed natively for the first time:**
  `relay-listener` (exactly one listener, the relay) and `relay-answers`.

**One probe failed: `only-admitted`.** It requires the admitted file to be
the workspace's only entry. The runner handed out the work script on the
first request and probed after the second (`probeAfterRequest: 2`). By then
Codex's own scripted edit, `routed-launch.txt`, was in the workspace. That
was a runner ordering mistake, not a boundary failure. The simulator missed it
because the fake VM reported every probe as passed, whatever the workspace
held.

**Correction** (branch `codex/issue04-routed-probe-before-edit`):
- **The fake VM's probe is honest:** it now fails `only-admitted` whenever the
  workspace holds anything besides the admitted file. With the old order, the
  passing lineage then failed, as natively.
- **The fake provider now answers in this order:** keep-alive scripts until
  the probe has run, then the work script, then the final message. A resume,
  released at once, gets the work script first. `toolsWorked` credits only the
  work script's own call ID.
- **New tests:**
  - the provider's order;
  - a marker under another call ID is not credited;
  - the keep-alive cap hands out the work script when release never comes.
- **Mutants:** 5 tried on the new logic, all killed after the cap test was
  added:
  - work first;
  - any call ID;
  - no `unexpected` check;
  - a wrong work call ID;
  - no cap.
- **Docs:** the runbook states the new order and why.

No guest code changed, so the coding records stay valid. The Mac run is
repeated after merge, and the Windows run follows.

## Native routed acceptance passes on macOS and Windows (26–27 October 2026)

After PR #120 merged at `5763a29`, the owner ran the routed acceptance on
both hosts. Each run used a clean (`sourceDirty: false`), freshly built
`main` at `5763a29` and the host's existing coding record (policy
`89339099…` on both). Both runs had the same runner (`0706a59c…`), coding
probe (`6e7b3db4…`), gateway (`7df3a76b…`) and build (`4347151d…`, dist
`0fe3e56d…`) hashes.

| | macOS (`aios-macos-noshare`) | Windows (`aios-podman-noshare`) |
|---|---|---|
| Report | `macos/ticket04-routed-acceptance-20261026-225859.json` | `windows/ticket04-routed-acceptance-20261027-082717.json` |
| SHA-256 | `522d7d46…` | `9dc2bd50…` |
| Outcome | `observed-offline-routed-acceptance` | `observed-offline-routed-acceptance` |
| Stages passed | 9 of 9 | 9 of 9 |
| Coding probes passed | 26 of 26 | 26 of 26 |
| Launch requests (keep-alives) | 5 (3) | 6 (4) |
| Resume requests (keep-alives) | 2 (0) | 2 (0) |
| Total time | about 52 s | about 123 s |

On both hosts:
- **Probe before the edit:** the probe ran after the first request
  (`probeAfterRequest: 1`), while the launch held on keep-alive scripts, and
  saw 4 processes including its own descendant. `only-admitted` passed, as did
  the routed `relay-listener` and `relay-answers` controls.
- **Route and tools:** code mode ran the scripts. `apply_patch` and
  `exec_command` worked through the relay and the gateway on both turns. The
  marker reached the provider, with no `unexpected` requests and no gateway
  refusals. Every gateway request reached the provider and completed.
- **Threads:** both turns exited 0 on one thread. The resume (fence 2)
  continued the launch's thread (fence 1) with a fresh relay capability.
- **Grants:** each was revoked as `stopped` with its turn, and a later use
  was refused as `revoked`.
- **Stops and collection:** each exact stop left 0 processes. The launch
  collected `canary.txt` and `routed-launch.txt`, and the resume
  `canary.txt` and `routed-resume.txt`. Both final stops were confirmed.

Windows waited one more five-second keep-alive before the probe, as its VM is
slower. The Mac and Windows pins differ in the CLI, code-mode host and binding
hashes, as each host's record names its own.

**Windows host note.** A first Windows attempt that day blocked at
`coding-fresh-pins` (`Observation unavailable`) because the VM's network was
down. A stale `aios-podman-noshare-api.sock` in `%LOCALAPPDATA%\Temp\podman`,
left by an unclean shutdown, made `gvproxy` exit at start, so the guest's
`vsock-network.service` failed and SSH never answered. Deleting the stale
socket file fixed it without changing the VM. That blocked report is not
kept.

This completes the plan's slice 3 native check on both hosts, offline and
without inference. Still open:
- **No real provider.** A real reply's size, timing and events are for
  slice 5.
- **Route continuity.** The guest still doesn't compare a predecessor's route
  with a resume's. That is still the owner's decision (3a receipt).

Production remains disabled.
