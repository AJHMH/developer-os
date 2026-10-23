# Ticket 04 receipt: stable VM identity in the native binding

Date: 23 October 2026. Branch `codex/issue04-stable-vm-identity`.

## What was observed

On 23 October the owner's Mac coding record was refused twice, each time right
after the VM `aios-macos-noshare` had started, because `bindingSha256` had
moved. The owner checked the VM's hardware UUID
(`/sys/class/dmi/id/product_uuid`) across a `podman machine stop` and `start`.
It changed, from `0542570a-…` to `b9c8020a-…`, and the next coding acceptance
was refused with a new binding (`41178a12…`).

Apple's hypervisor gives the VM a new hardware UUID on every boot. Both guest
management programs, coding and validation, bound a digest of it as the VM's
`hostId`. So every VM restart on the Mac voided both owner admission records.

Evidence, under `macos/`:
- `ticket04-admission-acceptance-20261023-074926-blocked.json`: refused at the
  record after the VM was started.
- `ticket04-admission-acceptance-20261023-075513.json`: the owner's updated
  record, passing.
- `ticket04-admission-acceptance-20261023-080418-restart-blocked.json`:
  refused again after one more stop and start, with nothing else changed.

## What changed

The owner chose to name the VM by its `/etc/machine-id`. That ID is kept on
the VM's disk, so it survives restarts, and a new VM gets a new one.

- `src/podman-coding.ts` and `src/podman-validation.ts`: each guest program
  now binds `hostId` as the digest of `/etc/machine-id`. The ID must be
  exactly 32 lowercase hexadecimal characters, so a missing, uninitialized or
  malformed ID is refused. The read needs no `sudo`. The two programs are
  changed together, as the duplication note in `src/podman-validation.ts`
  requires.
- The simulators (`tests/helpers/native-coding-guest.py` and
  `tests/helpers/native-validation-guest.py`) gain a per-boot hardware UUID
  and a machine ID that tests can change.
- `docs/macos-worker-qualification.md` and `docs/isolated-validation.md` say
  that a restart keeps a record valid and a recreated VM needs a new one.

Both programs changed, so `policySha256` changes for coding and validation.
The binding changes too. Each owner record on each host needs one
re-approval, written by the owner.

## Evidence

- New tests in `tests/worker-native-coding.test.mjs` and
  `tests/worker-native-validation.test.mjs` run the real guest programs
  against the simulators:
  - a changed hardware UUID leaves the pins unchanged;
  - a changed machine ID changes the binding but not the policy;
  - an empty, uppercase, 31-character or 33-character machine ID is refused.

  Before the fix, both tests failed at the restart step with a moved binding,
  which matches what the Mac showed.
- Mutation: accepting any machine ID made both tests fail.
- Checks on Node 24.22.1:
  - formatting and typecheck pass;
  - the affected suites pass, 184 of 184;
  - the full suite under c8 has 1,019 tests: 1,015 passed, 4 skipped, 0 failed.
- Coverage:
  - gate 1: lines went from 20,983 of 21,548 to 20,987 of 21,552, and branches
    from 5,713 of 6,161 to 5,714 of 6,162;
  - gate 2: the 6 changed `src` lines are covered, and the change adds no
    branches.
- Review: Standards and Spec ran in parallel.
  - Fixed: a terse local name; a regex written differently from its neighbours;
    test names that didn't match; a doc note that didn't say why.
  - Left as is: the two new tests mirror each other. Each uses its own suite's
    fixture.

## Open

- **Real-host proof.** The simulators show that a restart no longer moves the
  binding. On a real host it remains to be seen: after the owner writes new
  records, stop and start the VM and rerun the acceptance.
- **Recreated VM.** Whether a recreated VM really gets a new machine ID depends
  on the VM image generating it on first boot. It has not been checked with
  `podman machine rm` and `init`.
- **Older qualification path.** `src/vm-management.ts` still binds the hardware
  UUID, and its `hostId` feeds the binding in `src/podman-host.ts`. This slice
  leaves it unchanged; whether to change it is the owner's call.
- **Windows.** Hyper-V normally keeps a VM's hardware UUID, but the Windows
  records still change here because both programs changed.

Production remains disabled.
