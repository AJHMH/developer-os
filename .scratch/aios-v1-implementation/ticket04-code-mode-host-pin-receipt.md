# Issue 04 slice 3, step 2: the code-mode host pin

Base: `main` at `8a18594`. 25 October 2026. No inference, no credentials, no
native run.

## What changed

The coding worker now carries `codex-code-mode-host` as a second pinned
binary beside `/codex` (ADR 0002 amendment).

- **Pins.** Each host target pins `codeModeHostSha256`, taken from the same
  official package as its worker CLI. `CodingPins`, `codingPinFields`,
  `validCodingPins` (and so the owner coding admission record) and both
  native acceptance scripts now carry it.

  | Target | Package | `bin/codex` | `bin/codex-code-mode-host` |
  |---|---|---|---|
  | darwin (guest arm64) | `codex-0.161.0-linux-arm64.tgz`, `sha512-SBu0n4C1…/Fg==` | `0129f94f…28a7` | `64efe2950af9d8ac9e9b94b0aac5e41f56307422e34e66a4217aaea0a221fed0` |
  | win32 (guest x64) | `codex-0.161.0-linux-x64.tgz`, `sha512-AVkNzeJW…hgA==` | `9a820c17…6c9c` | `e87096087c02aa6ab90a5a85031659665aa0bf3ee20c07ca0b8ab701c83fcd5b` |

  The arm64 tarball came from the Mac's npm cache. The x64 tarball was
  fetched with `npm pack --ignore-scripts` on the Mac with the owner's
  approval (164,668,500 bytes). Each one matched the integrity recorded on
  11 October and its registry `dist.integrity`. In each package, `bin/codex`
  is byte-identical to the pin we already have.
- **Guest (`src/podman-coding.ts`).** The guest checks the owner-provisioned
  `~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0` at every
  snapshot: inspect, prepare and the other actions. The file must be an
  ordinary single-link file owned by the guest user, private to that user,
  with the pinned hash.
  - At prepare, the guest copies it to `<operation>/codex-code-mode-host`
    (mode 0500).
  - At launch, the guest rechecks that copy.
  - The copy is bind-mounted read-only at `/codex-code-mode-host`, and the
    effective-configuration check expects exactly four mounts.
- **Docs.** `docs/worker-qualification.md` gains the provisioning commands
  for both hosts, and the macOS guide's record example gains the new pin.

The locked argv, the sandbox mode and the relay are unchanged. They are
slice 3, step 3.

## Evidence

- **Full suite: 1,146 tests, 1,142 pass.** It ran on the Mac with the
  settings in `ticket04-gateway-shape-receipt.md`. The one failure was the
  known load-sensitive 5-second Python check in `tests/podman-platform.test.mjs`
  ("native stop cannot mistake a timed-out engine query…"), which passed
  twice alone.
- **New tests.** The host is copied and mounted read-only beside Codex. Each
  of these is refused:
  - a missing or foreign host, at inspection, before any worker exists;
  - a host replaced after inspection, before create;
  - a session copy altered before launch, before start;
  - a worker created without the host mount, before start;
  - an admission record with a missing or malformed host pin.

  The host-target digests are pinned exactly.
- **Mutants: 9 tried, 9 killed.** The mutants:
  - pins naming the CLI digest;
  - no snapshot host check;
  - no launch recheck of the copy;
  - the host mounted writable;
  - the host not mounted;
  - any mount count;
  - the host pin not validated;
  - a wrong darwin digest;
  - no private-mode check on the host file.

  While checking the launch-recheck mutant, I found a test that passed for
  the wrong reason: the simulator crashed on a wrong path. I fixed it before
  it counted.

- **Factory coverage gate: passed** (`f78ebdb`, base `8a18594`).

  | Measure | Global | Changed `src` |
  |---|---|---|
  | Lines | 21757/22305 (baseline 21721/22269) | 43/43 |
  | Branches | 5935/6383 (baseline 5934/6382) | 6/6 |

  The test stages took 215–223 s of the 240 s limit. The gate measured the
  commit before the review fixes. Those fixes touch only tests, docs and
  this receipt, so I reran just `tests/worker-native-coding.test.mjs`
  (125 of 125 passed) and the format check.

## Review

An independent review found no blocking defects. It did raise four points,
all addressed before publication:
- the Windows copy command used a drive-letter path, so both hosts now use a
  relative one;
- a test for a group-readable host file was missing;
- one fixture's host pin equalled its binding pin;
- the hashing cost needed recording.

Accepted, and left as they are:
- `provisioned()` does not `fstat` the opened descriptor, and the launch
  recheck reads through `pathlib`. Only the guest user can race either one.
  The hash binds the content, and `/codex` uses the same pattern.
- Every guest action now hashes about 67 MB more. Measure the poll cost
  against `commandMs` on Windows during the next native run.

## Owner steps after merge (both hosts)

1. Provision the code-mode host in the VM with the commands in
   `docs/worker-qualification.md`, and check that the printed hash matches.
2. Rewrite the owner coding admission record with the fresh pins, which
   include `codeModeHostSha256` and the changed `policySha256`. Then rerun
   the admission acceptance to confirm it.

Until both are done, coding on that host refuses at inspection. That is the
intended fail-closed behaviour.
