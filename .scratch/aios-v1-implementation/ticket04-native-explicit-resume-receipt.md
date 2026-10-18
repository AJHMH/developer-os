# Issue 04: explicit native session resume

Status: offline transport implemented, rebased onto main `461b62e` and
reviewed again with two security fixes (see the continuation below). The
earlier command-budget failure did not recur in the full candidate run. Hosted
checks and native resume qualification remain open. Production remains disabled.
Production remains disabled and native resume qualification remains open.

## Boundary and behavior

The native-only `NativeCodingRequest` extends the existing coding request with
`resumeFrom`, an explicit stopped predecessor session. Each resumed turn uses a
new operation ID, a nondecreasing ownership fence and an exact UUID thread ID;
there is no global last-session lookup. The old record must bind a complete
`thread.started` CLI event to that thread. Same source revision and branch are
required; base refresh refuses. The admitted manifest and actual transferred
bytes are checked as on first launch. Fresh files populate a new workspace;
prior workspace edits must be explicitly admitted by the caller to carry forward.

Under the existing shared management lock, guest prepare checks the predecessor's
identity, unchanged binding, independently stopped labeled container, empty
process census and inactive lease/deadline units. It saves a one-use reservation
before moving the private session home into the new operation. Existing retained
state must be an owned directory with no linked or special entries, at most 4096
entries, 4 MiB per file and 16 MiB total; a missing home refuses rather than being
recreated. Partial effects
remain blocked and retained; no rollback/retry silently reclaims that home.
The new worker receives the same deny-all network, read-only root, nonroot user,
capability/seccomp restrictions, bounded writable mounts and pinned executable.
Fresh dispatch checks, allowance, lease and deadline apply to the new turn.
Mismatched/missing complete resumed thread output refuses before returning it and
still runs exact-session shutdown. Old stopped containers/workspaces remain;
their identities cannot stop the new worker or claim the moved home again.

This native-only input is not wired into the production controller. The controlled
runtime guard remains intact. Fresh model-only authority, usage/restart approval,
base refresh, general recovery after a partially prepared home transfer, and real
Windows/macOS resumed CLI and adversarial isolation qualification remain open.
No online inference, credentials, provisioning or real VM observation was used.
Historical macOS receipts bind earlier versions and do not qualify this runtime.

## Evidence and retained corrections

The pre-agreed public transport run seam and external host/process/guest fixtures
are used; tests do not query management journals. The positive resume regression
failed on baseline with `Native resume is not qualified`, then passed after the
implementation. The external engine fixture now retains independently named
containers across turns. Its first version incorrectly replaced a caller-updated
current observation with a stale map copy; an unchanged expiry-observation test
caught this. The fixture was corrected, without changing that test's assertions
or production code. A new timer-refusal test initially targeted a nonexistent unit
because stopped timers had been collected; it now targets the recorded native
unit, and refuses as intended. These were test-fixture corrections, not evidence
of a production timeout repair.

All 123 initial focused transport/lifecycle tests passed. After review fixes,
all 21 focused explicit-resume cases passed; the final suite also includes an
additional first-launch/predecessor refusal and restored-home retry assertions. New cases cover exact retained
home/thread, fresh isolation, single-use ancestry, explicit latest-turn chaining,
unsafe CLI/identity refusals, stale fence, unknown predecessor, source/branch drift,
running/orphan evidence, active timers, denied dispatch, callback mutation and
mismatched/missing resumed thread events. All previous assertions remain, apart
from updating the old blanket resume refusal to retain malformed-resume refusal.

The Standards review identified inconsistent named-container targeting in the
expanded fixture. It now reports actual names and distinct process/cgroup identities
for every retained container and resolves commands by their explicit target.
A live-successor regression proves predecessor observation/recovery refuses
without affecting the successor, followed by successful exact successor shutdown.
Both review axes are clear after re-review. A self-review red test demonstrated
that missing or linked retained home state had been accepted by the initial
candidate. Those cases now refuse before reservation, and repairing the external
home permits a new explicitly admitted attempt. The first missing-home test used
a removal helper incompatible with the external filesystem mock; it was corrected
to rename the home and then reproduced the expected missing rejection.

A full validation started before review finished. Review changes invalidated its
candidate binding; its result is retained as superseded and cannot authorize the
final candidate. Final full validation runs after those source/test changes,
under the unchanged 600-second macOS profile with a process-bound awake assertion.

## Investigation accounting

The existing external ledger is
`/private/tmp/issue04-native-timer-continuity-ledger`, scope
`issue04-native-explicit-resume`. The owner explicitly added 60 active minutes and
two repair cycles; all previous usage/failures remain. The red-capable command is
`AIOS_TEST_PYTHON=/usr/bin/python3 node --test --test-name-pattern="native.*resume" tests/worker-native-coding.test.mjs`.
Earlier Linux/Windows timeouts remain unresolved; this slice does not claim a
root-cause repair for them or broaden their investigation scope.


A final continuity regression changed the trusted host executable observation
while leaving the guest binding unchanged. The initial candidate accepted resume;
the red failed with `Missing expected rejection`. Prepared records now persist
complete admitted pins, resume requires an exact predecessor pin match, and
launch independently checks those staged pins against the guarded request.
Legacy records missing these pins cannot authorize resume/launch; independent
stop/recovery remains available. The positive resume and host-pin drift refusal
both pass. Both review axes cleared this delta. The preceding full-suite pass is
retained as superseded by this source change; final full validation follows.


## Final candidate validation blocker

The final source stayed unchanged throughout full validation. Type checking and
format checking passed; the suite failed with a visible failure in unchanged
`guest command budgets keep Mac scheduling bounded and Windows unchanged`
(5003.3 ms). The existing Python subprocess deadline remains 5000 ms. Bounded
stdout was truncated, so the original assertion detail and subprocess status,
signal/error were not retained; no specific timeout signal or cause is claimed.
The final build after the suite did not run because the command uses `&&`.

All 130 final focused transport/lifecycle tests pass. One diagnostic rerun of the
unchanged command-budget test passed in 52.7 ms; this does not explain or waive
the original failure. The failing test and `src/podman-native.ts` and
`src/podman-platform.ts` match baseline exactly. Attribution still needs evidence:
new test workload is not ruled out merely by unchanged source. A disposable
unchanged-main full comparison is in progress under the same dependency/Python,
600-second profile and process-bound awake assertion. No unrelated repair or
policy change is included. The [validation record](ticket04-native-explicit-resume-validation.json)
binds the final source/test/helper hashes and retains every superseded attempt.


The unchanged-main full comparison at `19cc1ca` passed all four command stages
under the same 600-second limit. This shows no persistent baseline failure in
that observation; it does not rule out candidate workload or explain the earlier
failure. Attribution remains unresolved. No unchanged candidate full-suite rerun
was used to fish for green, and no deadline/assertion/coverage/approval exception
was applied. Implementation is preserved uncommitted pending this validation
blocker; no PR or production admission is claimed.


## 17 October continuation: rebase, review fixes and revalidation

The uncommitted candidate was recovered byte-identically from the branch backup
(`working.patch` and the two untracked records; all three source/test/helper
hashes matched the validation record) and applied cleanly to main `461b62e`,
which includes the PR #72 command-budget diagnostics.

An independent review found two gaps, each fixed red-first:

- **Retained Codex configuration (major).** Resume moved the entire predecessor
  `CODEX_HOME`. That home is worker-writable, and Codex 0.161.0 reads
  `config.toml`, `hooks.json`, `AGENTS.md`, `AGENTS.override.md`, `skills/` and
  `rules/` from it (confirmed from the pinned binary's strings and its
  `--ignore-rules` option). One turn could therefore configure hooks, MCP
  servers, instructions or sandbox settings for the next. Guest management now
  refuses resume, before reserving the predecessor, when any of these names
  exists at the top of the retained home (case-insensitive). Five new tests plant
  each name and observed `Missing expected rejection` before the fix; they now
  refuse with no second container created and the predecessor home unclaimed.
- **Unpinned resumed sandbox (minor).** First launch pins
  `--sandbox workspace-write`; `codex exec resume` has no `--sandbox` option
  (verified with the pinned binary's help), so the resumed turn pinned no mode.
  Resume now requires `-c sandbox_mode="workspace-write"` before the thread ID,
  at both the host and guest boundaries, and the controller's resume arguments
  supply the same pin. The unpinned refusal case was red before the fix
  (resume was accepted); a `danger-full-access` case guards the pin's value and
  was already refused before the fix only because of its argument count. The positive resume assertion
  now compares the last eight container arguments, including the pin.

Relative to the recovered tests, no assertion was removed; the single changed
assertion line (`slice(-6)` to `slice(-8)`) now also checks the pin.

**Validation (Linux container, Node 24.15.0, Python 3.13, 600-second limit).**
Typecheck and format check passed. The suite ran 816 tests: 809 passed, 4
skipped and 3 failed. The three failures are publication signing fixtures that
spawn `ssh-keygen`, which this container lacks (spawn status `null`); the same
three tests fail identically on unchanged main `461b62e` in the same container,
so they are attributed to the environment, not this change. The build, which
the chained command skipped after the test failure, passed when run separately.
`guest command budgets keep Mac scheduling bounded and Windows unchanged` passed.
This is not the earlier declared macOS profile; it does not explain or waive
the earlier 5003 ms failure, whose attribution remains unresolved. Hosted checks
on the published head are the authoritative full run.

**Native observation.** `native-coding-resume-acceptance.mjs` is an explicit,
offline, credential-free procedure: a deny-all first launch must record exactly
one `thread.started` event; the predecessor must be independently observed as
stopped; a pinned explicit resume must report the same thread; a second resume
of the consumed predecessor must refuse; and stopped collection must return the
unchanged canary. It has only been syntax-checked here and has not been run on
a native host. Its outcome is **not-run**.

## Invocation after review and build

Run on the Mac with the dedicated pinned machine already enrolled
(`aios-macos-noshare` in earlier receipts), through the existing acceptance
lock/awake wrapper, from a clean build of the reviewed head. Use a new report
path for every attempt; the runner refuses to overwrite retained evidence.

```sh
npm ci --ignore-scripts && npm run build
node scripts/run-native-acceptance.mjs "$QUALIFIED_STATE_DIR" .scratch/aios-v1-implementation/native-coding-resume-acceptance.mjs -- "$DEDICATED_MACHINE" "$NEW_REPORT_PATH" --approve-offline-native-run
```

A `blocked` outcome is evidence, not a failure to hide: the stage names and
bounded errors show where native behavior differs (for example, no
`thread.started` before the offline turn fails, a rollout Codex cannot find
after the home transfer, or a refused carried configuration file that Codex
itself wrote). An observed result remains `qualified: false` and
`productionEnabled: false`; it does not check off any native criterion alone.
