# Ticket 04 receipt: offline native validation executor

Date: 22 October 2026. Branch `codex/issue04-native-validation-executor`.

The owner chose this scope:
- an offline executor first;
- checks in the image the owner's contract declares, loaded by the owner;
- a separate owner validation admission record per host.

## What changed

- **Shared admission reader.** `src/coding-admission.ts` now exports
  `ownerAdmission(path, kind)`, the private-record reader generalized over a
  scope, a label and exact pin fields. `ownerCodingAdmission` is a thin
  wrapper with the same scope, behavior and messages.
- **`src/native-validation.ts`** adds:
  - validation pins (`imageSha256`, `policySha256`, `bindingSha256`);
  - `offlineValidationEnvironment(image)`, with the fixed offline network
    policy digest `3f47dc24…85d3`, no registries, no caches and no fixtures;
  - `ownerValidationAdmission`, scope `aios-native-validation-admission-v1`;
  - the `IsolatedValidationTransport` seam;
  - `PinnedValidationRuntime`, which implements `ValidationRuntime`.
- **How `PinnedValidationRuntime` admits and gates checks:**
  - It admits a live transport only while the owner record names its exact
    pins. A controlled transport must have none.
  - It re-checks the binding, environment, attempt identity and check bounds
    before each check.
  - Every transport effect needs a fresh record read and the controller's
    authority.
  - Results must carry the attempt, check and pins.
  - It always attempts a stop, but trusts the receipt only after a fresh
    inspection under the record.
- **Shared host plumbing.** `src/native-management.ts` holds the
  `podman machine ssh` invocation, the guest binding checks and the binding
  digest, extracted from `src/podman-coding.ts`. The coding management program
  is unchanged, so the coding `policySha256` pin and existing coding records
  are unaffected.
- **`src/podman-validation.ts`** adds `NativePodmanValidationTransport`, live,
  with production disabled. Its guest management program:
  - **inspect:** measures the VM as the coding guest does, plus the
    owner-loaded image by ID and architecture.
  - **prepare:** keeps the attempt's files as a pristine input, never
    mounted, after checking them against the host's manifest digest. It is
    idempotent, and the tree is never replaced.
  - **start:** gives each check a fresh copy of the input and creates a fresh
    container:
    - by image ID, with no network, a read-only root, a private `/tmp`, all
      capabilities dropped and no new privileges;
    - with seccomp, user 65534, 256 processes and 1 GiB of memory;
    - with only that copy bound.

    It verifies the effective configuration, arms a guest deadline timer at
    the check's timeout, then starts the check.
  - **poll:** once no process remains, reports the exit code. Only the
    deadline timer's own kill counts as a timeout. It then removes the
    container, measures the copy with the input's manifest and removes it.
  - **stop:** fences the attempt where the disk allows, then kills and
    removes every container and confirms no process remains. It measures any
    copy not yet measured and removes the attempt's files inside the user
    namespace. It reports the tested tree only if every copy was unchanged;
    otherwise it reports a different tree. A check cannot make stop fail:
    unreadable entries, trees nested past the path limit and a full disk at
    the first write all still stop cleanly.
- **`scripts/run-native-validation-admission-acceptance.mjs`** is an owner-run
  offline acceptance. It validates a synthetic baseline through the real
  transport. Its five checks are probes that pass only under isolation:
  - the tree is present;
  - there is no network;
  - the root filesystem is read-only;
  - the user is 65534;
  - no engine socket is visible.
- **Documentation:** `docs/isolated-validation.md` has a new section, and
  `CONTEXT.md` defines Owner validation admission and Offline validation
  environment.
- **Unchanged:** the controller, the CLI and the production default.
  `DELIVERY_NOT_ENABLED` is unchanged.

## Evidence

- `tests/native-validation.test.mjs` (15 tests) runs through
  `DeliveryController`:
  - an admitted baseline passes, with every local check dispatched in order;
  - exit codes and guest timeouts become statuses;
  - a missing or controlled-mode record is refused, as is each changed pin;
  - coding-scope and malformed records are refused;
  - contracts declaring registries, caches, another image or another network
    policy are refused before any check;
  - fresh pin drift is refused;
  - revocation mid-attempt closes the transport gate, stops further checks and
    leaves the stop untrusted;
  - a changed measured tree is never a pass;
  - forged results are refused;
  - out-of-bounds requests are refused;
  - the acceptance script covers the admitted, mismatched, failed-probe,
    revoked and argument paths.
- `tests/worker-native-validation.test.mjs` (27 tests) runs the real guest
  management program in `tests/helpers/native-validation-guest.py`, a
  simulated Linux and Podman engine:
  - inspection binds image, VM and program;
  - missing, drifting and foreign-architecture images are refused, as is a
    foreign running container;
  - exact create flags, the image by ID, a single bind mount and the deadline
    timer are checked;
  - private, never-mounted input;
  - every check starts from exactly the transferred tree;
  - an earlier check's change is never hidden by a later clean check;
  - a replaced tree is refused at prepare and, by itself, at start;
  - nonzero exits are reported, and only the guest deadline's own kill is a
    timeout;
  - manifest drift is refused;
  - engine isolation drift is refused before start;
  - revocation before prepare, start and polls is honored;
  - a refused or unarmed deadline prevents start, and stop still cleans up;
  - stop measures the unchanged tree;
  - new files, changed bytes, executable bits and symbolic links are reported
    as a different tree;
  - stop is idempotent, and a stopped attempt is fenced;
  - control characters in argv are refused on the host and, by themselves, in
    the guest;
  - a check cannot wedge stop with an unreadable workspace, folders nested
    past the path limit or a full disk at stop's first write;
  - malformed requests are refused before any VM effect.
- Every mutant that compiled was ultimately killed. The guest mutants were
  re-run after the review rework. Mutants covered:
  - the live-without-record admission, the environment-digest gate, the
    record-backed dispatch gate, the timeout mapping, trust in the stop
    receipt, the result pins, the timeout bound and the local-scope check;
  - `--network=none`, the manifest check, prepare idempotency, the
    network-mode verification and the foreign-container check;
  - the kill on stop, the image ID check, the armed deadline, start's tree
    binding and the argv control-character check;
  - per-check measurement, a fresh copy for every check, reporting the first
    changed copy, and the deadline-service timeout;
  - measurement errors as changes, and fencing that tolerates a full disk.

  First-round survivors exposed test gaps, which were closed: the refusal step
  was asserted, the simulator gained image ID drift, an unarmed timer and a
  missing bind source, and later checks must see the transferred files.
- Checks on Node 24.22.1:
  - typecheck and format check;
  - the full suite: 1,016 tests, 1,012 passed, 4 skipped, 0 failed.
  - Coverage gate 1: lines rose from 20,050 of 20,615 to 20,983 of 21,548
    (97.37%), and branches from 5,579 of 6,024 to 5,714 of 6,162 (92.72%).
  - Coverage gate 2: changed `src` lines were 1,037 of 1,037 covered and
    changed branches 153 of 159 (96.2%).
- The guest Python program sits inside a string, so c8 cannot measure its
  branches. The simulator suite covers it.
- Review: the Standards and Spec reviews ran in parallel. Their findings were
  fixed:
  - a check could wedge stop with unreadable, deeply nested or disk-filling
    content;
  - later checks ran on an earlier check's output;
  - a doc comment overstated what the transport binds;
  - an out-of-memory kill after the deadline counted as a timeout;
  - a 7-argument management call; check bounds duplicated in TypeScript; an
    untyped action set; a PascalCase local.

  The limits are now documented. The deliberately duplicated guest helpers
  and acceptance setup each carry the reason: every program and runner is
  pinned by its own digest.
- The existing native coding (106), coding admission (33) and feature
  candidate suites pass unchanged after the plumbing extraction.

## CI follow-up

On PR #93's first run, the macOS CI job failed 17 simulator tests; every
other job passed. The simulator removed workspaces with the host's
`rm -rf --one-file-system`, a GNU-only option that macOS's BSD `rm` rejects,
so the guest correctly refused to continue. The real guest runs only inside
the Fedora CoreOS VM, which has GNU `rm`, and is unchanged. The simulator now
checks that the guest sent exactly that command, then removes the folder
portably. The next run passed all but the tree nested past the path limit,
which macOS's `rm` cannot remove beyond its 1,024-byte path limit. The
simulator now removes trees with relative steps only, one directory at a time,
so neither depth nor path length matters on either system. The same test
passes past Linux's 4,096-byte limit as well.

## Remaining

The owner's native run of the validation acceptance remains, on the Mac and
on Windows. Also open:
- registries and dependency installs, and caches;
- browser and database fixtures;
- declared output paths for build and coverage artifacts;
- hosted checks;
- production enablement.

Production remains disabled.
