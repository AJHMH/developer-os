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

## First native run on macOS, and the probe correction (23 October 2026)

After PR #100 merged at `3d02d39`, the owner re-approved the Mac coding
record. All reports are under `macos/`.
- `ticket04-admission-acceptance-20261023-204118-blocked.json`: refused, as
  expected. Only the policy pin moved, to `fa91be00…`; the binding stayed
  `aac1b6b5…`.
- `ticket04-admission-acceptance-20261023-204459.json`: passed under the
  updated record, with `buildFresh: true` and a clean tree.

The owner then ran the qualification
(`ticket04-worker-qualification-20261023-204634-failed.json`, SHA-256
`61c01003…`). **Every stage passed:**
- **Pins:** each changed and missing pin was refused for both workers.
- **Coding:** the planted descendant was censused, and the exact stop left no
  process.
- **Validation:** all 18 probes passed. The guest deadline ended the forked
  descendants (`timedOut`, exit 137, 0 remaining). A stop mid-check left 0
  processes and the check did not pass. The late check was fenced. The
  changed tree was not reported as tested.

The outcome was `failed`, for one coding probe: `skills-mcp-hooks`. The coding
guest's own retained-home rules, in `src/podman-coding.ts`, explain the
likely cause. Codex regenerates `$CODEX_HOME/skills/.system`, its bundled
system skills, on every start. The guest admits exactly that folder, and
refuses anything else under `skills/` and any `config.toml`, `hooks.json`,
`AGENTS.md` or `rules`. The probe failed on any `skills` folder at all, which
is stricter than that policy. But the probe combined three checks, so the
report could not show which one failed.

**Correction** (branch `codex/issue04-probe-codex-skills`):
- The probe is split into `codex-skills`, `mcp-config` and
  `hooks-rules-agents`, so the next run names the exact cause.
- `codex-skills` passes only when the folder is absent or holds exactly
  `.system`, matching the guest's policy.
- `hooks-rules-agents` also covers `rules`, `AGENTS.md` and
  `AGENTS.override.md`, as the guest does.
- The probe is now 20 probes in 1,857 characters, within validation's argv
  bounds.
- New tests run the real probe against a real `HOME` folder: an empty home;
  `skills/.system` alone; `skills` with extra or other entries; `config.toml`
  with and without MCP servers; and each instruction or hook file.

The coding `policySha256` changes again, so each host's coding record needs
one more re-approval. The macOS run is repeated after merge, and the Windows
run follows on the same probe.

Checks on Node 24.22.1: formatting and typecheck pass. The full suite ran
1,060 tests: 1,056 passed, 4 skipped, 0 failed. The only `src/` change is the
probe table in `src/worker-probes.ts`, which the probe tests run in full.
Production remains disabled.

## Native qualification on both hosts (24 October 2026)

After PR #101 merged at `4f0dc83`, the owner re-approved each host's coding
record for the corrected probe and ran the qualification. Both hosts passed.
Both used the same probe (`probeSha256` `b30a0b39…`) and the same runner, with
the same coding policy pin (`c941c723…`) and validation policy pin
(`c213f918…`). Each ran from a clean tree with `buildFresh: true`.

### macOS (`aios-macos-noshare`), reports under `macos/`

- **Coding record re-approval:**
  - `ticket04-admission-acceptance-20261024-110803-blocked.json`: refused, as
    expected. Only the policy pin moved, to `c941c723…`; the binding stayed
    `aac1b6b5…`.
  - The confirming acceptance run after the edit was skipped. Two
    qualification runs, `…111626-blocked.json` and `…111835-blocked.json`,
    were then refused at the record with "Owner coding admission is missing
    or invalid", before any worker started.
  - The owner corrected the file at 11:23. It then passed every field check.
    The confirming run, `ticket04-admission-acceptance-20261024-112544.json`,
    passed.
- **Qualification:** `ticket04-worker-qualification-20261024-112721.json`
  (SHA-256 `a27c73e5…`), outcome `observed-offline-worker-qualification`.
  - All ten stages passed.
  - All 20 coding probes passed, including `codex-skills`, `mcp-config` and
    `hooks-rules-agents`. That confirms the 23 October failure came from the
    probe being stricter than the guest's policy, not from the boundary.
  - All 20 validation probes passed.
  - The coding descendant was removed by the exact stop.
  - The guest deadline ended the validation descendants (exit 137, 0
    remaining).
  - A stop mid-check left 0 processes and the check did not pass.
  - The late check was fenced.
  - The changed tree was not reported as tested.

### Windows (`aios-podman-noshare`), reports under `windows/`

- **Coding record:** re-approved by the owner; the confirming acceptance
  reports were not provided. The qualification's pins show the record named
  policy `c941c723…` and the unchanged Windows binding `f6dbbfd8…`.
- **Interrupted run:**
  `ticket04-worker-qualification-20261024-114105-interrupted.json`. Its first
  nine stages passed, then it was cut off during the last one, the changed-tree
  stage, about 7 minutes in. The report still reads `running`, and the
  wrapper's lock was retained, as it is only on interruption.
  - Before the lock was cleared, the owner confirmed no `node` process from
    the run remained and no worker container was running. No
    `aios-validation-…` container existed at all.
  - That attempt never reached its stop, so its private workspace copy may
    remain in the VM's validation state. It is bound to that attempt's own ID.
- **Qualification:** `ticket04-worker-qualification-20261024-115704.json`
  (SHA-256 `650f6c9f…`), outcome `observed-offline-worker-qualification`.
  - All ten stages passed, and all 20 probes passed in each worker.
  - The lifecycle results matched the Mac: descendant removed, deadline kill,
    stop mid-check, fence, changed tree never reported as tested.
  - The validation probes take about 5½ minutes on Windows, against 2 on the
    Mac. The whole run takes about 8 minutes.

### Against Issue 04's criteria

This is offline evidence on both hosts for:
- **criterion 1:** changed and missing pins refuse;
- **criterion 2:** only the admitted file enters;
- **criterion 3:** no shares, sockets, credentials, management or network;
- **criterion 5:** descendant stopping, the deadline, mid-check stop and
  fencing;
- **criterion 6:** independent retained results, including failed, blocked
  and interrupted attempts.

The runbook's stated limits still apply:
- recovery and safe import;
- coding fencing beyond the session acceptance;
- effective configuration is not kept in the report;
- the validation private path cannot be confirmed;
- `escape-unshare`'s option risk.

Criterion 4 (credentials, model-only mediation, usage) is not covered and
needs the credentialed slice. Whether these results let the Issue 04
checkboxes be ticked is the owner's decision. Production remains disabled.
