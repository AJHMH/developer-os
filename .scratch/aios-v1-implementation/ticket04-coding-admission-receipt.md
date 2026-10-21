# Ticket 04 receipt: owner coding admission

Date: 21 October 2026. Branch `codex/issue04-native-coding-admission`.

## What changed

- `src/coding-admission.ts` adds `ownerCodingAdmission(path, { clock })`. The
  record is an owner-written JSON file with exactly `scope`
  (`aios-native-coding-admission-v1`), `approvedAt` (canonical UTC, not after
  the clock) and `pins` (exactly the four coding pins). The path must be
  absolute. Neither it nor its real path may sit below a folder containing
  `.git`, which is checked when the admission is built and again on every read.
  Every read re-checks that the file is private and owner-controlled and that
  its folder cannot be changed by others. It then reads through one descriptor
  bound to the checked file. Any problem is reported only as "missing or
  invalid".
- `PinnedCodingRuntime` takes an optional admission. A controlled transport
  must have none. A live transport needs one whose pins equal the runtime pins.
  The check replaces every former `mode === "controlled"` test. A fresh read is
  required at construction, before execution, in the dispatch gate, on the turn
  result and when trusting a stop, recovery, reconciliation or cleanup receipt.
  While a turn streams, the per-frame gate accepts a read from the last second,
  so storage checks do not run on every frame. A stop is still always
  attempted.
- The controller is unchanged. The admitted runtime still reports mode
  `controlled`. Production delivery stays disabled (`DELIVERY_NOT_ENABLED`),
  and neither the CLI nor `PodmanHostAdapter` changes.
- `scripts/run-native-coding-admission-acceptance.mjs` is an owner-run offline
  acceptance. It drives one `codeFeature` turn through the real native
  transport under the owner's record. Planning, validation, onboarding and
  usage are synthetic stand-ins.

## Evidence

- `tests/coding-admission.test.mjs` (33 tests and subtests):
  - admitted end-to-end coding;
  - refusal without a record, with a controlled transport, and for each
    changed pin;
  - revocation after dispatch: refused at the next frame once the last read is
    over a second old, and otherwise refused on the result; the stop is always
    attempted and the session stays uncertain;
  - a record changed before dispatch (no run);
  - the bounded read age, which never survives a failed read or a backwards
    clock;
  - strict record validation, storage refusals, and repositories above the
    record (including one created later or reached through a symlink);
  - the acceptance script's admitted, mismatch, unsettled-session and argument
    paths.
- Mutation checks, each killed by a failing test:
  - removing the gate from the dispatch and per-frame checks, from execution
    start, from the result binding (fresh read) and from stop and receipt trust;
  - letting a controlled transport carry a record, or dropping the live-mode
    check;
  - widening the stream read age, ignoring it, or reusing reads across a
    backwards clock or a zero age;
  - the repository refusal at construction, on each read and through real
    paths;
  - the approval-time check and its clock;
  - the file and folder storage checks.
- Review fixes: the per-read repository and real-path checks, the
  descriptor-bound read, the injected clock, one shared pin-field list, the
  bounded stream read age, and settling a session from persisted state when a
  turn fails after dispatch. An interrupted run now also persists its outcome.
  The Windows ACL refusal path is covered by the existing Windows private-storage
  tests (`tests/windows-auth-store.test.mjs`),
  not by a new one here.

## Remaining

The owner's native run of the admission acceptance on the Mac and Windows hosts,
a native validation executor, credentialed resumed turns and production
enablement remain open. Production remains disabled.
