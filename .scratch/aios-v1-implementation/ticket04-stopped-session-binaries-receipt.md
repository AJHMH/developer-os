# Issue 04: stopped sessions no longer keep their program copies

Base: `main` at `67e2ccf`. 27 October 2026. No inference, no credentials, no
native run.

## Why

The Windows runs on 27 October filled the 10 GB VM disk. As the Windows
session reported it, each stopped coding session kept about 350 MB, mostly
its own copy of the Codex binary, and nothing removed it: 21 sessions held
5.9 GB (see the route continuity receipt's Windows host note). A full disk
blocked a launch and a resume.

## Decision

The owner chose to remove the copies at stop, and to trim sessions already
stopped once, by hand, rather than also pruning at each prepare.

## What changed

- **Guest (`src/podman-coding.ts`, stop action).** Once the worker is
  confirmed gone, stop removes the session's private `codex` and
  `codex-code-mode-host` copies, tolerating either being absent. It does this
  before the headroom and record writes, so it also frees a full disk. The
  workspace and home stay: collection reads the workspace and an explicit
  resume moves the home. A stopped session never runs again, and a resume
  writes its own copies into its new folder.
- **Tests:**
  - `tests/worker-native-resume.test.mjs`, new: a session run to completion
    through `NativePodmanCodingTransport` against the guest simulator keeps
    its workspace and home but neither copy; an explicit resume then still
    runs, and afterwards neither session holds a copy.
  - `tests/worker-native-coding.test.mjs`, changed: the code-mode host test
    read the copy after the run had stopped. It now reads it while the worker
    runs, which is what it checks.
- **Runbook (`docs/worker-qualification.md`, "Routed session acceptance").**
  States the behaviour and the pin change, and gives a one-time trim for
  sessions stopped earlier. It deletes only those two files, and only from
  sessions whose record says `stopped`, so a prepared session keeps the
  copies it needs to launch. The command has no double quotes, so it reads
  the same in zsh and PowerShell.

## Pins change

The coding guest program changed, so `policySha256` changes from
`77885706…` to
`829e7e1e92235293e7533dd9d301b0005a3cf54ea8a67cbbf700ec581a810781`, as
computed by `transport.inspect` in the simulator. Each host's owner coding
admission record needs one re-approval. Sessions stopped under the earlier
guest can't be resumed afterwards, as with any pin change.

## Evidence

- Written test-first: the new test failed with both copies present after
  stop, and passed once stop removed them. With the guest change reverted it
  fails again.
- **Full suite** (`AIOS_TEST_PYTHON=/usr/bin/python3 npm test`, Node 24.15.0,
  macOS): 1,257 tests, 1,250 passed, 4 skipped, 3 failed. Two are the known
  local SSH-signing passphrase prompts. The third, `Native Codex launch
  constrains thread pools…` in `podman-platform`, is the known load-sensitive
  test; it passes alone. The resume tests were rerun after the review edits:
  86 of 86.
- **Two-axis review:** no standards violations; the stop change matches the
  spec, and no other guest path reads a stopped session's copies (`effective`
  compares mount sources without opening them, and resume admission reads
  only the predecessor's record, container and home). Applied: the trim
  first checked only for running workers, so a prepared session could have
  lost its copies; it now keys on each record's `stopped` phase. The Windows
  command is written out, and the test helper's field is named `retained`.
- Not tested in the simulator: a stop before launch and a stop retried after
  a partial failure. Both tolerate absent copies (`FileNotFoundError`), and
  neither can be relaunched, since launch requires `prepared`.

## Not covered

- Not yet run natively. The routed acceptance after renewal exercises stop
  and resume on each host; whether the copies are gone there is checked by
  listing a stopped session's folder.
- Sessions stopped before this change keep their copies until the one-time
  trim.

Production remains disabled.

## Native renewal, trim and routed acceptance (27 October 2026)

After PR #124 merged at `801b2ff`, each host's coding record was renewed and
the routed acceptance rerun. On both hosts only `policySha256` had changed,
from `77885706…` to `829e7e1e…`, as computed in the simulator. The blocked
first runs that printed `freshPins` are not kept.

Both reruns used a clean (`sourceDirty: false`), freshly built `main` at
`801b2ff`, with the same runner (`0706a59c…`), coding probe (`6e7b3db4…`),
gateway (`7df3a76b…`) and build (`4347151d…`, dist `a4b3017a…`) hashes.

| | macOS (`aios-macos-noshare`) | Windows (`aios-podman-noshare`) |
|---|---|---|
| Report | `macos/ticket04-routed-acceptance-20261027-213128.json` | `windows/ticket04-routed-acceptance-20261027-214439.json` |
| SHA-256 | `21a0d15d…` | `4364bc9b…` |
| Outcome | `observed-offline-routed-acceptance` | `observed-offline-routed-acceptance` |
| Stages passed | 9 of 9 | 9 of 9 |
| Coding probes passed | 26 of 26 | 26 of 26 |
| Launch requests (keep-alives) | 5 (3) | 6 (4) |
| Resume requests (keep-alives) | 2 (0) | 2 (0) |
| Total time | about 59 s | about 124 s |

On both hosts, launch and resume each exited 0 on one thread, code-mode
tools worked through the relay and gateway with no `unexpected` requests and
no gateway refusals, each grant was revoked as `stopped` and later refused as
`revoked`, each exact stop left 0 processes, and both edits were collected.

**macOS trim and folders.** Before the trim, all 50 session records said
`stopped` and no coding worker was running. The VM disk was 75% used, and
session state held 9.0 GB, with 36 sessions still holding a Codex copy. The
runbook's trim removed 43 files: 36 Codex copies and 7 code-mode host copies
(older sessions predate the code-mode host). Session state went to 87 MB and
the disk to 29% used. After the rerun, neither new stopped session held a
program copy: the launch's folder held `workspace` (its `home` went to the
resume), and the resume's held `home` and `workspace`. No session folder on
the VM held a copy.

**Windows.** The report shows the pass under the renewed record. Whether the
one-time trim was run there, and what the stopped sessions' folders hold, is
not in the report and was not observed from this Mac.

This answers "Not covered" above for macOS, and for Windows as far as the
routed acceptance shows.

Production remains disabled.
