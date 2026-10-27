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

- **Not yet run on either host** when written. The Mac's offline run is
  recorded below. The probe still needs the native check with the capture's
  fake provider. That run would show busybox's real `wget` messages and
  Podman's real mount table and process status. It would also show whether
  Codex or the code-mode host opens a loopback listener of its own, which
  would fail `relay-listener`.
- **The live qualification** must probe a routed session between model
  requests. If the relay is serving a long reply, the probe's GET can wait
  past its retries. That fails closed.
- **Pins:** the coding guest program changes, so its `policySha256` does
  too. The re-approval already pending after PR 113 should be made after
  this merges, so that one approval covers both.

## Native qualification on macOS (25 October 2026)

After PR #115 merged at `5837a90`, the owner re-approved the Mac coding
record and ran the offline general-worker qualification on
`aios-macos-noshare`. It passed. The run used a clean, freshly built `main`
(`buildFresh: true`, `sourceDirty: false`). Reports are under `macos/`.

- **Coding record re-approval:** only the coding policy pin moved, from
  `c941c723…` to `89339099…`. The binding stayed `aac1b6b5…`, and the CLI
  and code-mode host pins were unchanged. The validation pins were unchanged:
  image `171e6526…`, policy `c213f918…`, binding `ac8967ce…`.
- **Blocked runs, kept as evidence:** both stopped at
  `owner-records-name-fresh-pins` with "Owner coding admission is missing or
  invalid", before any worker started.
  - `ticket04-worker-qualification-20261025-205831-blocked.json`: run
    before the records were edited, to read the fresh pins. The coding
    record failed its format check, not the pin match; the cause isn't
    recorded.
  - `ticket04-worker-qualification-20261025-211000-blocked.json`: the edited
    coding record's `approvedAt` year read `22026`, a future time. The
    validation record had also been given the coding pins' fields. Both
    records were corrected at 21:11.
- **Qualification:** `ticket04-worker-qualification-20261025-211228.json`
  (SHA-256 `00fd0079…`), outcome `observed-offline-worker-qualification`.
  - All ten stages passed, in about 3½ minutes.
  - Probe digests: shared `55749bc8…`, coding `6e7b3db4…`.
  - All 26 coding probes passed: the 21 shared probes and the five coding
    controls. All 21 validation probes passed, `npm-registry` included.
  - The session was offline, so `relay-listener` found no listener at all
    and `relay-answers` saw its connection refused. No loopback listener was
    open in the live offline session.
  - `read-only-binaries`, `hardened-process` and `writable-only-work` passed
    against Podman's real mount table and process status.
  - Lifecycle controls held: the planted descendant was censused and the
    exact stop left 0 processes; the guest deadline ended the validation
    descendants (exit 137, 0 remaining); a stop mid-check left 0 processes
    and the check did not pass; the late check was fenced; the changed tree
    was not reported as tested.

Still open:
- **Windows** has not yet run this probe.
- **A routed session** was not exercised. The relay's positive control, and
  probing between model requests, need the live run with the capture's fake
  provider.

Production remains disabled.
