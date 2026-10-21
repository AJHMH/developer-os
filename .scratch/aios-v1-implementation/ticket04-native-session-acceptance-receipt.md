# Issue 04: native macOS acceptance of general coding sessions

Status: observed on the owner's Mac on 20 October 2026 and on the owner's
Windows PC on 21 October 2026, offline, with `productionEnabled: false` and
`qualified: false`. Credentialed (inference) observation remains open.
Production remains disabled.

## What ran

`scripts/run-native-coding-acceptance.mjs`, through the shared
`scripts/run-native-acceptance.mjs` runner (acceptance lock and `caffeinate`),
drove the real `NativePodmanCodingTransport` against the dedicated AppleHV VM
`aios-macos-noshare`. It used the VM's existing coding authority, with no
credentials, no inference, no provisioning, and Codex 0.161.0 ARM64
(`0129f94f…`). The owner ran it in Terminal; the reports are kept in
`.scratch/aios-v1-implementation/macos/issue04-session-acceptance-*.json`.

The final run (`…-223145.json`) used exactly this branch's final code: its
runner hash `121b4875…` and transport build hash `61340483…` match a fresh
build of the committed sources. The earlier passing run (`…-215424.json`)
used the first version of the home stripping, before the security review.

## Result: every stage passed

Lineage A, about 50 seconds:
- a first launch reported an offline conversation thread in about 9 seconds;
- the first turn was independently observed stopped, with no processes;
- a resume onto a moved main, naming the exact base move, continued the same
  thread;
- the stopped workspace kept the moved main's admitted input;
- resuming the consumed predecessor again was refused by the guest's prepare;
- a resume halted after preparation was stopped, and recovery returned its
  session home;
- a resume after recovery continued the same thread.

Lineage B, about 35 seconds:
- a first launch reported a thread;
- a resume stopped right after launch, before the guest recorded any thread;
- recovery of that launched resume was refused;
- reconciliation reported it unresolved, and retiring it succeeded;
- lineage cleanup removed two sessions, and a repeat reported the same two;
- neither cleaned session could be resumed again.

All nine attempted sessions were stopped at the end with no remaining
processes. Lineage A's stopped sessions remain in the VM, as earlier runs' do.

## Windows result: every stage passed

On 21 October the owner ran the same command on the Windows PC (Windows
10.0.26300, x64) against the dedicated Hyper-V VM `aios-podman-noshare`, from
`main` at `1b34398`. Codex 0.161.0 there is the x64 build (`9a820c17…`). The
report is `.scratch/aios-v1-implementation/windows/issue04-session-acceptance-20261021-100937.json`.
Its runner hash `121b4875…` and transport build hash `61340483…` are the same
as the final Mac run's, so both hosts ran identical code. No Windows-specific
change was needed.

Every stage passed, in the same order as on the Mac. It took about 4.4
minutes, against about 1.5 on the Mac:
- each turn that reported a thread took about 25 seconds, against about 9;
- each guest action took about 3.5 seconds, against about 1.

The Windows coding authority (`40601adb…`, derived from the same label and
this machine name) was set up by this first run. All nine attempted sessions
were stopped with no remaining processes.

## Findings fixed along the way

1. **Offline Codex never exits.** Without network access it keeps retrying the
   provider until the turn's allowance ends, so the first run timed out after
   three minutes (`…-213707.json`). The script now ends each turn once Codex
   reports its thread; the transport then stops that exact session.
2. **Real Codex homes were never resumable.** The second run
   (`…-214443.json`) was refused at the first resume. A read-only listing the
   owner ran showed that Codex 0.161 writes built-in skills to
   `skills/.system` and helper links to `tmp/arg0` on every start, and the guest
   rightly refuses any `skills` folder and any link in a retained home. The
   owner chose "strip and regenerate". Before reusing a home, the guest checks
   everything else first, then removes only `skills` (and only if it holds
   nothing but `.system`), `tmp` and `.tmp`. Codex reinstalls these on its next
   start. Removal never follows links, and it scans each tree within fixed
   bounds (65536 entries, depth 256) before deleting anything. Anything else is
   still refused, with nothing removed: `config.toml`, `hooks.json`,
   `AGENTS.md`, `rules`, a capitalized `Skills`, a `skills` link, any other
   skill, and any other link. The conversation's sessions and databases carry
   over.

## Evidence at the seams

- The scenario is exported as `sessionAcceptance(transport)` and passes against
  the external guest fixture. It reports `blocked-before-thread` when no thread
  appears, and the command refuses missing arguments or approval.
- New guest tests cover:
  - a home with Codex's regenerated files resumes, keeping sessions and
    databases;
  - a planted skill beside `.system`, a configuration file, a capitalized
    `Skills` folder or a `skills` link refuses, and nothing is removed;
  - removing a regenerated link never touches its target;
  - a link elsewhere refuses;
  - a planted `rules` folder refuses.
- Mutation checks pin the skill-content check and the stripping step.
- A security review found that the first version stripped before refusing, and
  that removal was unbounded. Both are fixed, and the native run was repeated
  on the final code.

## Still open

- Credentialed (inference) resumed turns on either host.
- Adversarial isolation of resumed workers through this transport.
- Production integration; production remains disabled, and the parent ticket
  stays partial.
