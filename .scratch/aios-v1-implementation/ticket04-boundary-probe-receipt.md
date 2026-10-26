# Issue 04 slice 3, step 4: the coding boundary probe

Base: `main` at `a62030c`. 25 October 2026. No inference, no credentials, no
native run.

## What changed

- **The shared probe** (`src/worker-probes.ts`), run by both workers, gains
  `npm-registry`. A plain-HTTP fetch of `registry.npmjs.org` must fail, so a
  missing TLS client can't pass it for free. The script is now 1,944
  characters, within a validation check's 2,000.
- **The new coding probe** (`codingBoundaryProbe`) is the shared probes, then
  five coding-only ones. Its third argument is the session's mode, which the
  coding guest takes from the session's own record (`routed` when the
  admission has a model route, otherwise `offline`). The caller never
  chooses it.
  - **`relay-listener`:** routed means exactly one listening socket, on
    127.0.0.1:18091 (`0100007F:46AB` in `/proc/net/tcp`). Offline means none.
    Neither may have an IPv6 listener, and any other mode fails.
  - **`relay-answers`:** routed means a GET to the relay gets its empty 403,
    tried up to three times, five seconds each. That reaches the route
    without reaching the gateway or counting a request. Offline means the
    connection must be refused.
  - **`read-only-binaries`:** `/codex` and `/codex-code-mode-host` are
    read-only mounts, according to `/proc/self/mountinfo`, and refuse
    writes.
  - **`hardened-process`:** `CapEff` is all zeros, `NoNewPrivs` is 1 and
    `Seccomp` is 2.
  - **`writable-only-work`:** a file can be created and removed in
    `/workspace` and `/session`. Writes are refused in `/`, `/etc`, `/usr`,
    `/bin`, `/lib`, `/root`, `/home`, `/opt`, `/var`, `/srv`, `/etc/hosts`,
    `/etc/hostname` and `/etc/resolv.conf`. Podman's private in-memory tmpfs
    stays writable.
- **Guest and host.** The coding guest runs the coding probe, and the host
  parses the result against the coding names. The validation worker still
  runs the shared probe as checks.
- **The qualification runner** also records `codingProbeSha256`.
- **Docs.** `docs/worker-qualification.md` and ADR 0002 ("Probe") describe
  the checks.

## Evidence

- **Probe tests** (`tests/worker-probes.test.mjs`) run the real probe text.
  Only its fixed container paths and the relay port are moved into
  fixtures: `/proc/net/tcp` and `tcp6`, `/proc/self/mountinfo` and `status`,
  the binaries, the work directories, the refused places and the `/etc`
  files.
  - Each check passes on a correct fixture and fails on each fault:
    - another listener, an IPv6 listener, a relay in an offline session, or
      an unknown mode;
    - a writable mount;
    - a capability, a missing no-new-privileges, or no seccomp;
    - either work directory read-only;
    - a refused place that is writable, which leaves nothing behind;
    - a writable `/etc/hosts`.
  - **`relay-answers`** runs against real HTTP servers in a child process,
    because the probe blocks the test process. It needs `wget`, so it runs
    on Linux CI. This Mac has none, so I also ran it locally with a
    throwaway stand-in that mimics busybox's messages. That found a real
    bug: the offline check first accepted any wget failure, so a listener
    answering with an error passed.
- **Simulator tests** (`tests/worker-native-coding.test.mjs`):
  - The guest runs the coding probe.
  - An offline session gets `offline`.
  - A new routed live session gets `routed`, chosen by the guest.
- **Mutants: 20 tried, 20 killed.**
  - Covered:
    - every listener rule, including the mode default;
    - the binaries' mount and write checks;
    - each of the three process checks;
    - each part of the write check, including a single work directory and
      cleaning up after an unexpected success;
    - the `/etc` files;
    - the npm check;
    - the guest's mode choice;
    - the guest's script;
    - the host's name list;
    - the relay answer and the offline refusal.
  - The two `relay-answers` mutants were killed with the stand-in `wget`.
- **Full local suite: 1,224 tests, 1,219 pass, 1 fail, 4 skipped.**
  - The failure was a load-sensitive 5-second Python check in
    `tests/podman-platform.test.mjs` ("native stop cannot mistake a
    timed-out engine query for an absent container"). This change doesn't
    touch that file, and the check passed 3 of 3 alone.
  - Shard 4/8 still holds only one of the two heavy controller files, since
    no test file was added.

## Review

An independent review found two High issues, both fixed here:
- `read-only-binaries` could pass on a writable mount. A running executable
  refuses writes anyway (ETXTBSY), and the container user owns the files, so
  the check now reads the mount table.
- The `relay-answers` test deadlocked wherever `wget` exists. Its HTTP
  servers ran in the process that `spawnSync` blocks, so they now run in a
  child process.

It also raised these:
- **Fixed:** process hardening (capabilities, no-new-privileges, seccomp)
  wasn't probed, and the tmpfs exceptions weren't documented.
- **Fixed:** the relay serves one request at a time, so the routed GET now
  retries.
- **Not done:** an allowlist of writable mounts read from mountinfo. That
  would guess at Podman's real mount table before a native run shows it.
  The guest already pins the four bind mounts.

## Not covered (native)

- **Not yet run on either host.** The probe still needs the native offline
  check with the capture's fake provider. That run would show busybox's real
  `wget` messages and Podman's real mount table and process status. It
  would also show whether Codex or the code-mode host opens a loopback
  listener of its own, which would fail `relay-listener`.
- **The live qualification** must probe a routed session between model
  requests. If the relay is serving a long reply, the probe's GET can wait
  past its retries. That fails closed.
- **Pins:** the coding guest program changes, so its `policySha256` does
  too. The re-approval already pending after PR 113 should be made after
  this merges, so that one approval covers both.

## Native run on Windows (25 October 2026)

After this merged at `5837a90`, the owner ran the offline qualification on
the Windows PC against `aios-podman-noshare`, from a clean `main` with
`buildFresh: true`. All three reports are under `windows/`.

**Provisioning.** The owner copied the code-mode host from the official
`@openai/codex@0.161.0-linux-x64` package into VM management storage. Its
SHA-256 was `e8709608…` on the host, matching the runbook's pin. The
runbook's `podman machine ssh` step could not be used as written. The
machine key Podman generated sits under `%USERPROFILE%\.local`, which grants
read access to `CodexSandboxUsers`, so OpenSSH ignores the key as too open.
The owner used `scp` and `ssh` with a temporary copy of the key readable
only by them, then deleted the copy. The original key's permissions were
left alone.

**Two blocked runs, then a pass:**
- `ticket04-worker-qualification-20261025-202342-blocked.json` (SHA-256
  `02f91ea9…`): blocked at `coding-fresh-pins` with `Native coding inspect
  observation unavailable`. The file had been copied but not yet made
  private (`chmod 600`), and the guest refuses a code-mode host that others
  can read. No worker started.
- `ticket04-worker-qualification-20261025-202842-blocked.json` (SHA-256
  `43196d57…`): blocked at `owner-records-name-fresh-pins`, as expected,
  after the file was made private and its hash in the guest matched. Both
  workers' fresh pins were recorded. Coding: `cliSha256` `9a820c17…` and
  `bindingSha256` `f6dbbfd8…`, both unchanged; the new `codeModeHostSha256`
  `e8709608…`; and `policySha256` `89339099…`. Validation's three pins were
  unchanged and its record already named them.
- The owner re-approved the coding record with those pins
  (`approvedAt` `2026-10-26T01:29:30.000Z`).
- `ticket04-worker-qualification-20261025-203119.json` (SHA-256
  `50fb8e6f…`): **`observed-offline-worker-qualification`, with every stage
  passed and no failed probe.**

**What the pass shows:**
- **Pins:** each changed and missing pin was refused for both workers.
- **Coding:** all 26 probes passed, including `npm-registry` and the five
  coding-only probes. The session was `offline`, since the record has no
  model route. So `relay-listener` saw no listening socket at all, which
  answers the open question above: neither Codex nor the code-mode host
  opened a loopback listener of its own. `relay-answers` saw the connection
  refused. `read-only-binaries`, `hardened-process` and
  `writable-only-work` passed against Podman's real mount table and process
  status. The planted descendant was censused (2 processes), and the exact
  stop left no process.
- **Validation:** all 21 probes passed, `npm-registry` included. The guest
  deadline ended the forked descendants (`timedOut`, exit 137, 0
  remaining). A stop mid-check left 0 processes and the check did not pass.
  The late check was fenced. The changed tree was not reported as tested.

The run took 8 minutes 20 seconds, 6 minutes 24 seconds of it in the
validation probe checks. The probe digests were `55749bc8…` (shared) and
`6e7b3db4…` (coding).

**Still open:**
- the same run on macOS;
- the routed side of `relay-listener` and `relay-answers`, which needs a
  routed session (the live qualification);
- the runbook's Windows `podman machine ssh` step, on a host where
  `CodexSandboxUsers` can read the machine key.

Production remains disabled.
