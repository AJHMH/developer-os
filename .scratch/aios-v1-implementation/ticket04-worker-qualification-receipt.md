# Ticket 04 receipt: offline general-worker qualification

Date: 23 October 2026. Branch `codex/issue04-worker-qualification`.

The owner chose to qualify both general workers in one slice, offline, as the
next step toward Issue 04's native criteria. This slice builds the probe, the
coding guest's probe action and the owner-run runner. The native runs on both
hosts follow after merge.

## What changed

- **`src/worker-probes.ts`: the boundary probe.**
  - It is one fixed line of shell, 1,716 characters, built from a single table
    of probe names and bodies.
  - It uses only busybox tools and applets in the pinned Alpine images. It
    first proves each one exists, including the `chroot` and `unshare`
    applets.
  - It runs 18 probes:
    - **positive control:** the admitted file is visible and is the
      workspace's only entry;
    - **guest and host content:** no guest-private management path, and no
      owner home;
    - **in the worker's home:** no `.ssh`, `.gnupg`, `.gitconfig`, `gh`
      config, `.netrc` or `.aws`, and no MCP servers, skills or hooks;
    - **credentials and sockets:** no credential variables, and no engine or
      guest-management sockets;
    - **mounts and network:** no host-share mounts, loopback-only networking,
      and no outbound connection;
    - **hardening:** a read-only root, judged by its own mount options, and
      user 65534;
    - **escapes:** `unshare`, `chroot` and cgroup escapes are refused.
- **`src/podman-coding.ts`: a new `probe-boundary` guest action.**
  - **Gates:** it runs only in the exact live session, under the machine
    lock. The phase must be `running`, the session's own cgroup must be live,
    and the effective configuration is checked first.
  - **The probe:** it executes the fixed probe, never caller text. The
    arguments are the admitted file, which passes `path_ok` on both sides,
    and the session's own management record. The guest first confirms both
    exist.
  - **The descendant:** it then plants a detached `setsid sleep`. It waits
    until the session's census shows the new process and adds it to the
    record, so the exact stop must remove it.
  - The host method is `probeBoundary(session, admittedFile)`. The probe is
    part of the program, so the coding `policySha256` changes, and each
    host's coding record needs one re-approval.
- **`scripts/run-native-worker-qualification.mjs`: the owner-run runner.**
  - It first runs the fresh-build check. It then needs both records to name
    fresh pins, and shows that every changed *and missing* pin is refused for
    both workers.
  - **Coding:** it runs the probe in a live session. It waits through the
    guest's refusal to observe a session it has not yet recorded. It then
    proves the exact stop left no process.
  - **Validation:** it runs one check per probe, each passing only on its own
    `passed-` line. It then shows:
    - descendants (including a `setsid` one) killed at a 3-second guest
      deadline;
    - a stop in the middle of a check;
    - a late check on the stopped attempt fenced;
    - a changed tree never reported as the tested tree.
  - The report keeps every stage, `failedProbes` as `worker:probe`, and
    `not-run` for stages that never ran.
- **Docs:**
  - `docs/worker-qualification.md` is the runbook, with commands for both
    hosts and stated limits. It is linked from the README.
  - `CONTEXT.md` defines **Boundary probe**.

## Evidence

- `tests/worker-probes.test.mjs` runs the real probe under a real shell:
  - one verdict per probe, in order;
  - the controls detect what they look for (a missing admitted file, a
    readable private path, credential variables);
  - malformed output is refused;
  - every body stays inside its own single-quoted shell word;
  - the probe fits validation's argv bounds.
- On this unconfined cloud container, the probe correctly fails these probes:
  - tools, only-admitted, credential-files, credential-env;
  - engine sockets, loopback-only, read-only root, unprivileged;
  - the unshare and cgroup escapes.
- `tests/worker-native-coding.test.mjs` runs the real guest program in the
  simulator:
  - the probe runs as fixed text with exactly the expected arguments;
  - the planted descendant enters the census, and the exact stop removes it;
  - failed probes are reported as failed;
  - it refuses outside a live session, an unsafe or missing file, a wrong
    fence, malformed output and an unobserved descendant, with no probe run.
- `tests/worker-qualification.test.mjs` drives the runner through fake
  transports:
  - the passing path;
  - each worker's failed probe, kept as evidence;
  - records naming other pins, and a runtime admitting a changed or missing
    pin: each blocks with no worker effect;
  - a surviving descendant, a missed deadline, an unfenced late check and a
    hidden changed tree: each blocks at its own stage;
  - waiting through an observation before the session is recorded;
  - `not-run` stages, and argument refusal.
- The runner refuses a stale build. `tests/fresh-build.test.mjs` now covers
  four runners.
- The real pinned runtimes refuse every changed and missing pin, for both
  workers.
- Checks on Node 24.22.1:
  - formatting and typecheck pass;
  - the full suite under c8 ran 1,053 tests: 1,049 passed, 4 skipped, 0
    failed. One more malformed-result test was added afterwards, and its
    suite passes 118 of 118.
- Coverage:
  - gate 1: lines went from 20,990 of 21,555 to 21,125 of 21,690, and
    branches from 5,714 of 6,162 to 5,735 of 6,184;
  - gate 2: changed `src/podman-coding.ts` lines are 46 of 46 covered.
    `src/worker-probes.ts` is new, with 89 of 89 statements and 11 of 11
    branches covered. Changed branches were 19 of 20 (95%) before the added
    test covered the last one, the guard against a malformed guest result.
- **Mutants:**
  - Killed: the record check, changed-pin refusal, missing-pin refusal,
    deadline, fence, changed tree, failed-probe outcome, the
    observation-race handling, and the probe's format guard.
  - One equivalent survivor: dropping `remainingProcesses === 0`. The
    `processesGone` check covers it, and the transport refuses an
    observation that is gone while reporting processes.
- **Review:** the Standards and Spec reviews ran in parallel.
  - **Fixed — the Spec blocker.** The runner observed the coding session
    before the guest had recorded it.
  - **Fixed — false passes.** Read-only root, which user 65534 could not
    write to anyway, and the unproven `chroot` and `unshare` applets.
  - **Fixed — gaps.** Only-admitted, credential files, skills/MCP/hooks,
    missing pins and `not-run` stages.
  - **Fixed — standards.** A single probe table, worker-prefixed failures,
    clearer names, awaiting the run before cleanup, a tree-digest guard, the
    glossary term, the README link and the re-approval note.
  - **Left as stated limits in the runbook:**
    - no recovery or safe-import coverage, and no coding fencing beyond the
      session acceptance;
    - effective configuration is not kept in the report;
    - the validation private path cannot be confirmed;
    - `escape-unshare`'s option risk;
    - `probe-boundary` is not limited to qualification.

## Open

- The owner re-approves both coding records, then runs the qualification on
  the Mac and on Windows.
- The coverage items listed under the runbook's limits.

Production remains disabled.

## CI follow-up

On PR #100's first run, only Windows CLI tests (5/8) failed, together with
the Windows summary check that depends on it. The owner provided the job log:
`not ok 124 - a validation probe check passes only on its own probe's verdict`,
with an exit status of `null`. That test runs the check's shell through
`/bin/sh`, which Windows does not have. It now carries the same POSIX-only
skip as the other shell-based probe tests. The check's shell only ever runs
inside the Linux worker, so nothing else changes.
