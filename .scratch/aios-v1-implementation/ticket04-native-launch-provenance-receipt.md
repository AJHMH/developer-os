# Issue 04: native launch provenance admission

Status: local implementation validation and both review axes passed. Production execution remains
disabled; explicit native resume remains refused and unqualified.

## Baseline and preservation

PR #70 merged as `003c89730a360082fd22a41815c941a4e7cb0aea`. Its tree equals
validated head `1e6a765` exactly; all applicable head checks and recognized human
approval passed. The coverage retry measured 100% changed lines without code,
test, deadline or threshold changes; its original instrumentation timeout remains
unexplained and retained in the private investigation ledger. No unrelated
baseline repair is included here.

Local main was fast-forwarded and the confirmed merged clean task branch was
retired. Work continues on `codex/issue04-native-launch-provenance` in the existing
isolated checkout. The original checkout and unrelated records/branches remain
preserved. Passing validation was reused for the identical merged baseline;
this new source receives fresh validation.

## Contract and implementation

The canonical file-input contract hashes an ordered JSON manifest of
`{path, sha256, executable}` records. Host admission now verifies that the actual
bounded ordinary-file payload matches `inputSha256` before any host observation.
It requires an explicit start intent, a syntactically immutable 40-character
lowercase hexadecimal source revision, a 64-character manifest digest, and a
bounded safe `codex/` branch. Unresolved revisions, missing values, traversal,
lock suffixes, control/trailing whitespace and unsupported intent refuse.

The guest independently validates provenance and rehashes the transferred bytes
using the same compact UTF-8 manifest contract before creating the operation
workspace, copying the artifact, or creating a container. Existing file count,
byte, path, redaction, duplicate-name and executable-type limits remain intact.
All files are admitted before materialization. The guest records the declared
source revision, branch and digest durably with the prepared session. Launch
requires that recorded admission to equal the guarded host request before any
container start; missing/changed provenance refuses. Existing callbacks, fresh
runtime pins, timer continuity, process census, exact-session stop and collection
requirements remain in force.

This binds declared provenance, not proof that a Git object exists or that files
belong to it. The controller still admits repository snapshots. No worker gains
repository Git metadata or management authority. The branch subset is deliberately
conservative and covers the controller's generated `codex/feature-*` names and
existing offline observation runners.

## Public-seam evidence

The existing public `NativePodmanCodingTransport.run` seam and external host/guest
fixtures are used. No private journal/table assertions or real VM are involved.
The transported Python management program still executes in the external guest
fixture, with engine commands simulated.

These regressions each failed with `Missing expected rejection` before its fix:

- A supplied digest unrelated to actual admitted bytes was accepted.
- Transferred bytes changed after host admission were accepted by guest prepare.
- Changed launch provenance was ignored before starting the prepared container.
- An unresolved source revision was accepted instead of refused before effects.

They now refuse at their declared boundaries, with no container creation/start as
appropriate. Valid ASCII input retains the existing transfer/stream/stop behavior;
a literal UTF-8/executable manifest passes stopped collection. The initial positive
assertion incorrectly compared the complete collection to input, including the
fixture's additional worker output and observation metadata. It was corrected to
assert the admitted file's actual path, bytes, executable flag and ordinary-file
observations. Production code was not changed to satisfy that assertion.

All 107 focused native transport/lifecycle tests passed before the final extra
terminal-newline refusal cases were included in full validation. Both review axes report zero actionable findings. The final full macOS
validation sequence (typecheck, format check, full test suite and build) passed
in 342.9 seconds under the unchanged 600-second profile, with a PID-bound awake
assertion. Exit was zero with no timeout or termination failure. Bounded stdout
was truncated; no exact full-suite test count is claimed. The
[validation record](ticket04-native-launch-provenance-validation.json) retains
exact tested source/test/helper hashes and the original result reference. Original test assertions
are retained; the shared valid request fixture now uses its actual canonical
manifest digest rather than an arbitrary placeholder.

## Qualification and remaining work

No native run was performed for the changed policy/runtime. PR #70's macOS timer
observations remain evidence only for their recorded source/module/policy hashes;
they do not automatically qualify this change. Independent Windows and macOS
qualification, explicit general resume, fresh model-only access authority,
usage/exhaustion, dependency and writable-storage/resource controls, adversarial
containment and production controller installation remain open.

The existing private ledger `/private/tmp/issue04-native-timer-continuity-ledger`
tracks scope `issue04-native-launch-provenance`, preserving consumed time/cycles,
prior failures and the unresolved instrumentation timeout. No allowance was reset
or extended. CI/review waits are excluded; diagnosis/editing/local revalidation is
accounted. No safety checks, thresholds, deadlines or approval rules are relaxed.


The preservation audit retains all 96 original test/helper files. All original
native test lines remain in order except the corrected request-fixture digest;
no existing assertion was removed. No workflow, Factory pin, coverage threshold,
command deadline or qualification rule changed.
