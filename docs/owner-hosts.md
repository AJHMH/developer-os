# Owner hosts

Native runs are the owner's, on the owner host: the owner's Mac
([ADR 0007](adr/0007-macos-only-owner-host.md)). Commands written for the owner
use these values; each is private to the Mac and outside every repository
unless noted.

| Fact                          | macOS (Terminal, zsh)                                     |
| ----------------------------- | --------------------------------------------------------- |
| Checkout                      | `~/Repos/developer-os` (keeps `main` checked out)         |
| VM                            | `aios-macos-noshare`                                      |
| Coding admission record       | `$HOME/.developer-os/admission/coding-admission.json`     |
| Validation admission record   | `$HOME/.developer-os/admission/validation-admission.json` |
| Pinned native `codex` 0.161.0 | `$HOME/.developer-os/ticket4-macos/runtime/codex-0.161.0` |
| Acceptance state              | `$HOME/.developer-os/ticket4-macos/state`                 |

The pinned `codex` hash is `nativeCodexSha256` in `src/host-target.ts`. A
usage read through any other `codex`, such as the Codex app's, is refused.

## Admitted guest programs

Each owner admission record pins its guest program's digest as
`policySha256`. These are the digests the records on the Mac admit:

| Guest      | `policySha256`                                                     |
| ---------- | ------------------------------------------------------------------ |
| Coding     | `89f2db6033e05941ec94dbb11e0215a1161d469429b85af47ba8fff5442c6a1c` |
| Validation | `585cd02cc6a9eff07e8e4f1f16d96719b3f24f40f0f7f57b349a7c0d1927448f` |

`tests/zzz-docs-commands.test.mjs` fails when a guest program
(`src/podman-coding.ts`, `src/podman-validation.ts`) no longer matches this
table. That change needs the owner to rewrite the matching record on the
Mac before the next native run. Say so in the PR's "Pin impact", and update
this table once the owner has re-pinned.

Before changing a guest program to deal with what is in a VM, ask the owner for
the [coding container census](worker-qualification.md#coding-container-census),
so the change is sized against the real counts.

## Fixed worker's offline pins

The offline pins that `pin-offline` writes, and `qualify`, `offline-canary`
and the routed runner read through `--worker-policy`, include a
`policyVersion`. It hashes the VM management program (`src/vm-management.ts`,
through `vmManagementVersion`) and the host canary. A change to either moves
it, and `qualify` then refuses offline admission at `observation` until the
owner enrolls new pins with `pin-offline` into a new file on the Mac. Say so
in the PR's "Pin impact", as for a guest program.

PR 198 moved it without saying so. The Mac was re-pinned on 7 November to
`$HOME/.developer-os/ticket4-macos/pins-routed-20261107a.json`
([receipt](../.scratch/aios-v1-implementation/ticket04-macos-routed-run-repinned-receipt.md)).

## Next coding guest change

Each coding guest change costs a re-pin on the Mac, so these wait for one
that has to happen anyway, and land with it:

- Add `operationId` and `fence` to the session record. Records hold only a hash
  of the identity, so lineage cleanup can't be pointed at a session from the
  guest's own records.
- Bound the `cleanup-abandoned` batch by time as well as by count. A batch of
  slow failures can pass the host's 45-second limit, and a re-run starts in the
  same order.
