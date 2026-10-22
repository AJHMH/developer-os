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

## Native macOS admission acceptance (22 October 2026)

The owner ran `scripts/run-native-coding-admission-acceptance.mjs` on the Mac
against `aios-macos-noshare`. The run used a clean `main` at `3a4863c`, after
the [inspection identity fix](ticket04-admission-inspect-identity-receipt.md),
under the owner's own admission record. The outcome was
`observed-offline-admission-acceptance`.

- Every stage passed:
  - fresh pins;
  - the owner record naming those pins;
  - the admitted runtime, refusing each changed pin;
  - one controller coding turn through the real transport, in about 65 s;
  - a recorded, stopped coding thread.
- The pins were CLI `0.161.0` (`0129f94f…`), policy `ede40015…` and binding
  `45fe7baa…`. The binding pin had changed from `146cffa5…` the day before,
  so the owner wrote a new record.
- Delivery stayed blocked at `DELIVERY_NOT_ENABLED`. The feature outcome was
  `exhausted`, because offline Codex retries the provider until the one-minute
  allowance ends, so no candidate was produced. The report confirms
  `threadStarted: true`, `sessionState: stopped`, `productionEnabled: false`,
  `qualified: false` and `inferenceAuthorized: false`.
- Planning, validation, onboarding and usage were synthetic. There were no
  credentials and no inference.
- The report is retained as
  `macos/ticket04-admission-acceptance-20261022-094540.json` (SHA-256
  `a70a9336…8eb0`). The earlier blocked runs are recorded in the inspection
  identity receipt.

The Windows admission run, a native validation executor, credentialed resumed
turns and production enablement remain open. Production remains disabled.

## Native Windows admission acceptance (22 October 2026)

The owner ran the same acceptance on the Windows PC (Windows 10.0.26300, x64)
against the dedicated Hyper-V VM `aios-podman-noshare`, from `main` at
`389dc7b`, under a Windows owner record. The record was written by the owner,
in a folder owned by the owner, with access limited to the owner, SYSTEM and
Administrators.

- The first run, with no record, stopped before coding and printed the fresh
  pins:
  - CLI `0.161.0` (`9a820c17…`), the Windows binary pinned in
    `src/host-target.ts`;
  - policy `ede40015…`, the same as the Mac;
  - binding `90aef186…`.
- The second run was blocked at the record. The record named the right pins
  and passed the ownership and ACL checks, but its `approvedAt` was
  `"20261022-134907"`, a report-file timestamp rather than a canonical UTC
  time. The gate refused it as "missing or invalid" before any coding.
  - A read-only checker, run on the PC, ran each record check separately and
    named `approvedAt` as the only failure.
  - The owner rewrote that field. Kept as
    `windows/ticket04-admission-acceptance-20261022-151328-blocked.json`.
- The third run had the outcome `observed-offline-admission-acceptance`, and
  every stage passed:
  - fresh pins;
  - the record naming those pins;
  - the admitted runtime, refusing each changed pin;
  - one controller coding turn through the real transport, in about 72 s;
  - a recorded, stopped coding thread.
  - Delivery stayed blocked at `DELIVERY_NOT_ENABLED`, and the outcome was
    `exhausted` with no candidate, as on the Mac. The report confirms
    `productionEnabled: false`, `qualified: false` and
    `inferenceAuthorized: false`.
  - Kept as `windows/ticket04-admission-acceptance-20261022-154337.json`
    (SHA-256 `8bc8ffe8…09c2`).
- The passing report records `sourceDirty: true`, and the cause was not
  identified:
  - The blocked run 30 minutes earlier recorded a clean tree.
  - `git status --short` was empty when the owner checked shortly after the
    run.
  - The runner digest and all four built module digests (`podman-coding`
    `1fb3696b…`, `feature-candidate` `905d5e51…`, `coding-admission`
    `071ea188…`, `controller` `72dd0d90…`) equal those of the clean-tree Mac
    run.
  - The 21 October Windows session acceptance also recorded an unexplained
    dirty flag.

Both hosts have now observed owner coding admission end to end. A native
validation executor, credentialed resumed turns and production enablement
remain open. Production remains disabled.
