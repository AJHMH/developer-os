# Plan: Issue 04, integrating the general coding transport

Status: **proposed; it waits for the owner's decisions D1 to D4 below.**
Date: 6 November 2026. Measured at `main` `03f2903`.

## What it covers

The first unchecked item of
[Issue 04's remaining implementation](issues/04-isolated-worker-gate.md):
"Integrate the general coding transport with the pinned dedicated VM". The
item's text predates ADR 0004, so this plan first says what of it is already
done, then splits what's left into slices. The plan itself, and a dated
comment on Issue 04 pointing to it, change no source.

## Where the item stands

Done, with production disabled:

- `code-feature` installs the owner-admitted native coding runtime from the
  CLI (ADR 0004 slices 4 and 5). `nativeCodingRuntime` wraps
  `NativePodmanCodingTransport` in `PinnedCodingRuntime`, with the owner
  record's pins re-measured at every effect (`src/native-coding-runtime.ts`).
  The native CLI delivery acceptance passed on both hosts on 1 November
  (`docs/feature-candidate.md`).
- The transport resumes a named stopped predecessor and thread, including onto
  a moved `main` (`baseMove`, in `run` in `src/podman-coding.ts`). The native
  evidence is the coding session acceptance's lineages A and B
  (`scripts/run-native-coding-acceptance.mjs`).

Still refused, each for a different reason:

1. **`PodmanHostAdapter.start()`** throws "Production worker execution is not
   qualified", and `qualified()` returns false (`src/podman-host.ts`). Only
   `DeliveryController.run()` calls a worker's `start()`, no CLI command calls
   `run()`, and only `tests/controls.test.mjs` drives it, with fake workers.
   Pause and cancel of a `delivery.execution` session still call the worker's
   `fenceAndStop()` (`src/session-lifecycle.ts`), which on this adapter always
   returns `status: "unknown"`, so such a session is always left uncertain.
2. **Base refresh.** The native transport refuses any `baseRefresh` payload
   (`run` in `src/podman-coding.ts`; `tests/worker-native-coding.test.mjs`
   checks the refusal). Only `refreshMergeBase` produces one, through
   `repairCandidate`, after it has retired a publication. So it can't be
   reached until publication and merge run natively.
3. **Repair from the CLI.** `repair-feature` is a bare `idAction` with no
   options or runtimes (`src/cli-commands.ts`). `repairCandidate` needs an
   admitted candidate whose candidate validation stopped, and no publication.
   An offline turn never admits a candidate, so natively this is reached only
   after a routed turn has admitted one and `validate-candidate` has run on
   it. Today that path doesn't refuse cleanly: `repairCandidate` records the
   repair attempt first, then calls `executeFeature`, which throws for the
   missing runtime. Its `catch` passes the throw to `finishRepair` as a
   failure. That uses up a repair cycle, and it sets the candidate's
   validation back to `not-run`.
4. **Production mode, which includes production resume.** The controller
   admits only `runtime.mode === "controlled"` (`executeFeature` in
   `src/controller.ts`), and `PinnedCodingRuntime.mode` is fixed at
   `"controlled"` (`src/feature-candidate.ts`). A production resume is a
   resume in that missing mode, so it follows the same rule. ADR 0002
   ("Production") and ADR 0004 (decision 6) keep `DELIVERY_NOT_ENABLED` and
   `productionEnabled: false`, and make enabling production a separate
   decision that needs live verification.

## What every slice keeps

- Production stays disabled. No slice adds a mode past `"controlled"`.
- A generic request never broadens fixed-task credentials, mounts, endpoints
  or management authority (Issue 04). Each slice that adds an option, a mount
  or a file says how a test shows nothing broadened.
- Each slice is test-first against the simulators, with no native, VM or
  credential use, and goes out as its own PR through the bot publisher from
  the Mac (`docs/operator-tools.md`).
- A slice that changes a guest program says so in its PR's "Pin impact". The
  owner then re-pins both hosts and reruns the coding acceptances
  (`docs/owner-hosts.md`).

## Owner decisions

- **D1. What happens to `run()` and `PodmanHostAdapter.start()`?**
  - (a) Retire them. `code-feature` becomes the only coding dispatch, and
    item 1 drops the `start()` clause. `code-feature` already binds the owner
    record's pins, admitted files, usage and the route, which `run()` does
    not. A `delivery.execution` session then needs a stop that can be
    observed, since `fenceAndStop()` can only answer `unknown`.
  - (b) Keep `run()` as the future production entry point, and bring it up to
    `code-feature`'s bindings first.
  - (c) Leave both as they are, and reword item 1 to say the refusal is
    deliberate.
- **D2. Is a CLI repair turn routed from the start?** A repair needs an
  admitted candidate, and only a routed turn admits one, so native repair
  evidence needs a routed run either way. A routed repair turn spends the
  one-shot approval the way a routed `code-feature` turn does (ADR 0002). The
  choice is whether `repair-feature` gets the routed options in the same
  slice, or first ships offline-only and is shown only in the simulator.
- **D3. How does the guest show a base refresh to the worker?** The controlled
  contract hands the runtime both trees, `from` and `to`, with their
  revisions. Natively, the worker must be able to read both without writing
  either. The options are read-only mounts beside `/workspace`, or files the
  guest writes into the workspace before launch. The choice changes the
  coding guest program either way.
- **D4. When does base refresh land?** It's unreachable until publication and
  merge run natively. It could wait for the next coding guest change that has
  to happen anyway, together with the two items already queued under "Next
  coding guest change" in `docs/owner-hosts.md`, so that the owner re-pins
  once.

## Slices

1. **CLI repair on the native runtimes.** No guest or pin change. Tests,
   written first:
   - without a coding runtime, `repair-feature` refuses before it records a
     repair attempt, so no cycle is spent and the candidate's validation is
     unchanged. This fixes the stranding described above whatever D2 decides;
   - `repair-feature` takes `code-feature`'s options: the validation options,
     `--coding-admission`, `--codex-executable` and, if D2 allows, the routed
     options with their one-shot approval. The option rules match
     `code-feature`'s;
   - a missing or invalid record refuses before any state or VM effect;
   - on simulated transports, a candidate that failed `validate-candidate`,
     then `repair-feature`, ends at a revalidated candidate and
     `DELIVERY_NOT_ENABLED`;
   - a repair turn gets the same files, mounts, route and endpoints as a
     `code-feature` turn for the same delivery, and nothing more;
   - if routed, a repair turn spends the approval once, and a second turn
     without one refuses.

   The owner's native evidence follows the routed live turn
   (`scripts/run-native-routed-delivery.mjs`): after a candidate is admitted
   and fails validation, one routed repair turn under a fresh approval.

2. **`run()` and `start()`, per D1.** No guest or pin change. Before choosing
   how, measure what still depends on `delivery.execution`: `run()`, the
   pause and cancel stops, and the offline canary, which shares the session
   through `proposeWorker`. Under (a), the refusal and its fake-worker tests
   go, and pause and cancel keep their coverage through `code-feature`'s
   session. Under (b), `run()` gains `code-feature`'s bindings test-first,
   and still refuses production.
3. **Native base refresh, per D3 and D4.** This changes the coding guest
   program. The transport accepts `baseRefresh`, and the guest stages both
   trees as D3 says, rehashing every file as it does `files`. Tests run the
   real guest program against the simulator, including refusals for a
   revision or digest mismatch, a linked file and a write to either tree. A
   test compares the container's effective mounts and configuration with a
   turn without a base refresh, and allows only the two read-only trees. The
   owner re-pins both hosts and reruns the coding acceptances.

Production mode, and with it production resume, isn't a slice here. It needs
native evidence for all six of Issue 04's qualification criteria first, and
then an ADR that amends ADR 0002 and ADR 0004.

## Out of scope

- The other four items of Issue 04's remaining implementation, and its six
  qualification criteria.
- Native publication, review, merge and main synchronization (tickets 08 to
  14).
- Any live inference. Routed turns stay under the owner's one-shot approval.
