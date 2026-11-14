# #274: the complete controller qualification on macOS

13 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. The owner
ran every component from one freshly built, clean checkout of `main` at
`e049225` ([AJHMH/developer-os#323](https://github.com/AJHMH/developer-os/pull/323)),
in the order in
[macOS controller qualification](../../docs/macos-controller-qualification.md#running-it),
then combined them. Production stays disabled.

All of it ran under the re-pinned Claude Code guest: coding policy
`c8efc6b2…` (it was `c5a7a034…`), with the CLI 2.1.311, and the validation
image `9419aebd…`, PostgreSQL `e29b5f75…`, and Playwright 1.64.1 in
`2dee255e…`.

## Components

| Component    | Report                                              | Outcome                                            | SHA-256     |
| ------------ | --------------------------------------------------- | -------------------------------------------------- | ----------- |
| `worker`     | `issue04-worker-qualification-20261113-182906.json` | `observed-offline-worker-qualification`            | `ebb4df56…` |
| `session`    | `issue04-session-acceptance-20261113-183850.json`   | `observed-offline-session-acceptance`              | `b2881d15…` |
| `validation` | `issue16-validation-20261113-185327.json`           | `observed-offline-validation-admission-acceptance` | `5ae6d73c…` |
| `lifecycle`  | `issue16-lifecycle-20261113-192335.json`            | `observed-native-lifecycle-controls`               | `e5f5a008…` |
| `delivery`   | `issue14-cleanup-delivery-20261113-192905.json`     | `observed-native-delivery-through-cleanup`         | `702c6bdb…` |

- **Worker:** both workers' boundary probes passed, `proxy` in each and
  `cross-delivery` in the coding worker.
- **Validation:** dependencies, a fresh PostgreSQL and the browser, offline.
- **Lifecycle:** all 16 stages passed:
  - delivery A was paused mid-turn, which stopped that exact session; it
    resumed the thread to a candidate, was cancelled mid-validation, which
    stopped that exact attempt, and its resume was then refused with "A
    cancelled delivery cannot be resumed.";
  - delivery B's CLI was killed with `SIGKILL` mid-turn, the session stayed
    running, and `recover` stopped that same session;
  - delivery C's request for a symbolic link ran to the end of its turn, and
    no candidate was admitted;
  - each was released, and 4 coding sessions were removed from the VM.
- **Delivery:** all 18 stages passed, for $0.025. Delivery
  `ce88074f-968e-47ec-b3ca-f44ebe075d34` published the owner-signed commit
  `ccc5e67e…` in
  [AJHMH/aios-publication-acceptance#18](https://github.com/AJHMH/aios-publication-acceptance/pull/18),
  merged it onto `04157931…`, verified and synchronized main at `ccc5e67e…`,
  then deleted its feature branch, locally and on GitHub, and kept the same
  13 unmerged branches.

## Combined report

`issue16-complete-qualification-20261113-193939.json`,
`observed-native-complete-qualification`, SHA-256
`cda9eb35ee3cbe68233b0a91bacfc13e9d8ce10b2a5dd68b96cf77741437186d`. All five
components were accepted, nothing was missing, and all ten boundaries
passed:

| Boundary                   | Criterion | Evidence             |
| -------------------------- | --------- | -------------------- |
| runtime-pins               | 1         | worker               |
| boundary-probes            | 2         | worker, every probe  |
| signing-and-authentication | 3         | delivery             |
| output-admission           | 3         | lifecycle C, session |
| isolated-web-validation    | 3         | validation           |
| descendant-termination     | 4         | worker               |
| pause-and-cancel           | 4         | lifecycle A          |
| explicit-session-resume    | 4         | session, lifecycle A |
| controller-recovery        | 4         | lifecycle B, session |
| delivery-through-cleanup   | 3         | delivery             |

## Production admission

The owner rewrote `production-admission.json` twice, backing it up first
each time:

1. naming the new worker qualification, so the delivery could publish under
   the new coding pins: `check-production` printed `"level":"worker"`;
2. naming the combined report: `check-production` printed
   `"level":"complete"`.

The pilot (#275) requires the complete level.

## Findings

- **The first lifecycle run blocked** with "Observation unavailable", before
  any delivery or spend (`issue16-lifecycle-20261113-190032.json`). Quitting
  Podman Desktop, which starts at login and runs from the menu bar without a
  window, had stopped the VM. `podman machine start` brought it back, and the
  rerun passed. The three offline runs before it passed with Podman Desktop
  running, as its warning allows.

## Not covered

- **Delivery C's refusal reason.** The guest doesn't report why it refused
  the link, so a turn that refused for another reason would read the same.
- **Restart reconciliation after coding.** Recovery is shown for coding
  sessions; later stages' recovery is controlled only.
- **Production stays disabled.** The pilot (#275) remains.
