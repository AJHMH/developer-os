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

## Follow-up: Podman's last-start time (23 October 2026)

Branch `codex/issue04-binding-ignores-last-up`.

After PR #95 merged at `9516b10`, the owner re-approved the Mac owner
coding admission:
- `macos/ticket04-admission-acceptance-20261023-090638-blocked.json`: refused,
  with the expected new policy `0e5c9a9e…` and binding `bc61d760…`.
- `macos/ticket04-admission-acceptance-20261023-091229.json`: passed under the
  updated record.

The owner then stopped and started the VM, and the next run was refused again
with a new binding, `5eab1bca…`
(`macos/ticket04-admission-acceptance-20261023-091502-restart-blocked.json`).

**Measured, not guessed.** The owner copied the machine's Podman
configuration, `~/.config/containers/podman/machine/applehv/aios-macos-noshare.json`,
and the guest's `/etc/machine-id`, once before and once after another restart.
- The machine ID was unchanged.
- Of the configuration's 33 fields, only `LastUp` changed: `09:14:51` became
  `09:26:15`.

The binding hashed the whole configuration, so Podman's record of each start
moved it. The machine ID change was needed but was not enough.

**Fix.** `managementBindingSha256` in `src/native-management.ts` leaves out
`LastUp` and nothing else. Any other configuration change still needs a new
record. The guest programs are unchanged, so `policySha256` is unchanged. The
binding changes once, so each record needs one more update. The older
qualification path in `src/podman-host.ts` reads only named configuration
fields, so it is unaffected.

**Evidence.**
- The two restart tests now also change `LastUp` across the restart. They
  also check that a changed resource setting still moves the binding.
- Before the fix, both tests failed at the restart step, matching the Mac.
- Mutants were killed: hashing `LastUp` again, and dropping the whole
  configuration.
- Formatting and typecheck pass, and the affected suites pass, 184 of 184.
- The full suite under c8 on Node 24.22.1 ran 1,019 tests: 1,015 passed,
  4 skipped, 0 failed.
- Coverage:
  - gate 1: lines went from 20,987 of 21,552 to 20,990 of 21,555, and branches
    stayed at 5,714 of 6,162;
  - gate 2: the changed `src` lines are covered, and the change adds no
    branches.
- Review:
  - Fixed: the fixture's `machine` was renamed `machineConfig`, since
    `machine` already means the machine's name; the glossary term is now used;
    the two docs now match.
  - Left as is: the two tests still mirror each other.

Still open:
- **Real-host proof.** A real host has not yet shown that a restart keeps the
  binding. That needs the owner to update the record and then restart.
- **Other possible changes on restart.** The Spec review raised fields that
  were not measured: the SSH port, if Podman reassigns it at start; Windows'
  Hyper-V configuration; and the Mac's hostname, which can follow the network.
  Each is left in the binding until a measurement shows it moves on a plain
  restart.

## Native macOS restart proof (23 October 2026)

After PR #96 merged at `4e52d7d`, the owner re-approved both Mac records from a
clean `main`, then proved the restart on the real VM. All reports are under
`macos/`.

**Owner coding admission:**
- `ticket04-admission-acceptance-20261023-100836-blocked.json`: refused, as
  expected. The policy was unchanged at `0e5c9a9e…`, and only the binding
  moved, to `aac1b6b5…`.
- `ticket04-admission-acceptance-20261023-101335.json`: passed under the
  updated record.
- `ticket04-admission-acceptance-20261023-101808-after-restart.json` (SHA-256
  `d61e702a…`): the owner ran `podman machine stop` and then `start`, then ran
  the acceptance again **without touching the record**. It passed all five
  stages with the same binding, `aac1b6b5…`. The coding turn stopped cleanly,
  and delivery stayed blocked on `DELIVERY_NOT_ENABLED`.

**Owner validation admission**, re-approved for the new guest program, with
the same image `171e6526…`:
- `ticket04-validation-acceptance-20261023-102811-blocked.json`: refused, as
  expected, with the new policy `c213f918…` and binding `ac8967ce…`.
- `ticket04-validation-acceptance-20261023-103209-blocked.json`: refused at the
  record. The edited `policySha256` had 65 characters, with a leading `a` left
  from the old value. The gate did its job.
- `ticket04-validation-acceptance-20261023-103734.json` (SHA-256 `acbf464c…`):
  passed after the owner corrected the pin. All five isolation probes passed,
  and the attempt stopped with the tested tree unchanged (`ba14975e…`).

A plain restart of the Mac VM no longer voids the owner's records.

Still open:
- the Windows records, both of which need re-approval for the new guest
  programs;
- a restart check on Windows;
- checking that a recreated VM gets a new machine ID;
- the unmeasured fields listed above.

Production remains disabled.
