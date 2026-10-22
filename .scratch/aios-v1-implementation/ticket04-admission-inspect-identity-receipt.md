# Ticket 04 receipt: native inspection sends only the session identity

Date: 21 October 2026. Branch `codex/issue04-admission-inspect-identity`.

## Finding

The owner ran the coding admission acceptance on the Mac against
`aios-macos-noshare`, from a clean `main` at `7411ab2`. The record named the
fresh pins and the admitted runtime was built, but the controller recorded no
coding thread. The turn failed about two seconds after it began, the session
stopped cleanly, and no thread started. An earlier run that day, on a dirty
tree under the previous binding pin, stopped the same way.

The controller deliberately swallows turn errors, so the owner ran a diagnostic
wrapper outside the repository. It ran the unchanged acceptance and logged each
transport call. The pre-launch pin re-inspection threw a `DataCloneError`:

- `PinnedCodingRuntime.execute` re-inspects pins with the whole launch request,
  including the controller's `onEvent`, `mayDispatch` and `checkpoint`
  callbacks. This is intended: its drift tests mutate the request during that
  await.
- `NativePodmanCodingTransport.inspect` called `structuredClone` on its input,
  and functions cannot be cloned.
- The test fakes ignore their `inspect` input, and the native session acceptance
  inspects with plain sessions, so neither had exercised this combination.

## What changed

- `NativePodmanCodingTransport.inspect` now sends `this.session(session)`, the
  same identity projection (`operationId`, `fence`, `state`, `intent`,
  `threadId`) that its `stop` call and its own launch-time inspection already
  use. The guest reads only `operationId`, `fence` and `intent` from the
  session, and resume data travels outside it, so guest behaviour is unchanged.
  Inspection also no longer copies the prompt or input bytes into the
  management payload.
- `PinnedCodingRuntime`, the controller and every existing test assertion are
  unchanged. Production delivery stays disabled.

## Evidence

- `tests/worker-native-coding.test.mjs`: a new test inspects with a live launch
  request, callbacks included, through the native host fixture. The pins must
  match and management must receive exactly the session identity. The test was
  red with the same `DataCloneError` before the fix.
- Mutation checks, each killed by the new test:
  - restoring `structuredClone(session)`;
  - sending the unprojected request;
  - sending a shallow `{ ...session }` copy.
- Retained native evidence under `macos/`:
  - `ticket04-admission-acceptance-20261021-205559-blocked.json`, the
    clean-tree blocked report;
  - `ticket04-admission-inspect-diagnosis-20261021-205946.log`, the diagnostic
    log, which records call names, timings, errors and stage outcomes only.
- The diagnostic wrapper is kept beside this receipt as
  `admission-inspect-diagnosis.mjs` for reuse. It is not acceptance evidence.
  The Mac run used a copy outside the repository, at
  `~/.developer-os/diag/admission-diag.mjs` (SHA-256
  `7cdc73259732d1da9e1317fdd3ce5a7a26557b1d165ec2a9e728bff0d7744f29`), which
  found the checkout through the home folder. The kept copy finds it from its
  own location and names itself correctly in its usage line; it is otherwise
  identical.
- Checks on Node 24.22.1:
  - typecheck and format check;
  - the full suite: 974 tests, 970 passed, 4 skipped, 0 failed. Three signed-Git
    tests at first failed in the fresh cloud sandbox because `ssh-keygen` was
    missing, and failed identically on `main`. They pass once it is installed.
  - Coverage gate 1: lines were 20,051 of 20,616 against 20,050 of 20,615 on
    base, and branches stayed at 5,579 of 6,024.
  - Coverage gate 2: changed `src` lines were 2 of 2 covered and the changed
    branch 1 of 1.
- Review: the Standards and Spec reviews found no defect in the fix. They
  flagged only the diagnostic script's location wording and path, which are
  corrected above. The `inspect` parameter is still typed as a `CodingSession`,
  although callers may pass a whole launch request. That is a judgement call,
  left as is because the transport interface is shared.

## Remaining

The owner's native admission run on the Mac, after this merges, and on Windows.
A native validation executor, credentialed resumed turns and production
enablement remain open. Production remains disabled.
