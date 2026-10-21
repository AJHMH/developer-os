# Issue 04: owner cleanup of a retired resume lineage

Status: implemented on `codex/issue04-retired-lineage-cleanup`. Hosted checks
and native qualification remain open. Production remains disabled.

## The gap this closes

The [resume reconciliation receipt](ticket04-resume-reconciliation-receipt.md)
accepted a retired lineage's guest state as permanent residue: the retired
successor's folder with the moved session home, every predecessor's folder and
stopped container, and records that stay reserved. Nothing removed it. The
owner chose to remove the whole lineage while keeping the records, through an
explicit owner call.

## Behavior

- **Retirement keeps the binding.** Retiring now records the retired session's
  binding (`feature.retirements[].session`), so the lineage can be named
  later, after coding has restarted fresh.
- **`DeliveryController.cleanupRetiredLineage(id, operationId)`.** It requires a
  recorded, not yet cleaned retirement, an owned quiescent delivery and the
  same trusted coding runtime with cleanup support. It records `cleanedAt` and
  the session count on the retirement, once. A failed, uncertain or mismatched
  receipt records nothing and can be retried. A predecessor can only be cleaned
  through its retired successor. Retirements recorded before this change carry
  no binding and are refused. A verified cleanup is recorded even if ownership
  changed during the guest call, because the removal already happened.
- **`PinnedCodingRuntime.cleanup`** checks the pins before and after, and
  requires an exact operation, fence and a positive whole session count.
- **Guest `cleanup-retired`** (`NativePodmanCodingTransport.cleanupRetiredLineage`,
  for a stopped resumed session):
  - It requires the session to be marked retired, stopped and gone, then walks
    its recorded predecessors (at most 256). Each must be stopped, gone and
    reserved by the next session in the chain.
  - Before removing anything, it checks every session: the lease and deadline
    units are inactive or failed, any container carries exactly this authority
    and session label and has no process, and any folder is a real directory
    owned by the guest user, not a link.
  - It then removes each container and folder and marks each record
    `cleaned`. Folder removal never follows links, and it reopens owned
    directories a worker made read-only so a re-run can't get stuck. Records keep their reservation and retirement marks, so prepare
    still refuses to resume any of them.
  - A repeat is idempotent. If removal stops partway, for example because the
    engine refuses, a re-run completes it.
- `CONTEXT.md` defines "retired resume lineage" and "lineage cleanup".

## Evidence

Tests go through the agreed seams:
- the public `DeliveryController` (`retireResume`, `cleanupRetiredLineage`,
  `codeFeature`, `release`) with the controlled runtime;
- `PinnedCodingRuntime` over a controlled transport;
- `NativePodmanCodingTransport` against the external guest fixture. The fixture's
  simulated engine gained `podman rm`.

Covered:
- A retired two-session lineage loses both folders and containers, keeps both
  records marked `cleaned`, cleans up idempotently, and is never resumed.
- An engine refusal partway leaves only the successor removed; a re-run
  completes the cleanup, including a read-only directory a worker made. The
  read-only case only bites on non-root runners; the cloud suite runs as root.
- The guest refuses, removing nothing, for an unresolved resume, an adopted
  resume, a predecessor reserved by another session, a lineage container that
  still reports a process, a container with a foreign label, an active lease
  timer and a folder replaced by a link. A running container also changes the
  engine binding, which refuses earlier.
- The transport rejects a malformed, non-stopped or non-resume session before
  guest effects, and treats an unrecognized receipt as uncertain.
- The controller records the cleanup once, refuses a second cleanup, an unknown
  operation, a predecessor, a runtime without cleanup and a released delivery,
  and records nothing for a failed, empty or foreign receipt.

Not separately tested: a lineage longer than two sessions (an adopted middle
link is walked like any predecessor), the controller's quiescence guard, and
a retirement without a recorded binding.

TDD: the controller and native tests failed first. The pinned-runtime test was
written after its implementation and then mutation-checked. Mutation checks:
each guest, transport and controller guard was removed in turn and the focused
tests rerun, and each covered guard has a failing test.

Review: the Standards review asked for shared identity and guest helpers (now
`sessionIdentity`, `units_quiet`, `stopped_container`, also used by prepare),
accurate comments and a single retirement lookup. The Spec review found that a
read-only worker directory could block every re-run, and that the receipt
overstated test coverage. All are addressed.

No Codex binary, credentials, online inference or real VM was used. Folder
removal and engine `rm` behavior on the real guest remain for native
qualification.

## Still open

- Base-refresh resume.
- Real Windows and macOS qualification of resume, recovery, reconciliation,
  restart and cleanup.
- Production remains disabled, and the parent ticket stays partial.

## Windows shard rebalance

Hosted Windows shard 7 hit its 10-minute job limit on this PR. It runs
`feature-candidate.test.mjs` alongside `worker-native-resume.test.mjs`, and it
had already been close to the limit (9m57s on PR #82). The coding-session tests
(resume, recovery, reconciliation, lineage cleanup, usage authority,
monitoring, restart approval and the mediation link) moved unchanged to
`tests/zz-feature-coding-session.test.mjs`. The `zz-` prefix sorts it near the
end, so Node's `--test-shard` assignment changes for one other file only:
`zz-operator-tools.test.mjs` moves from shard 1 to shard 2 (checked with
`node --test --test-shard` before and after). The new file lands on shard 1,
which finished in about 4 minutes on this run; shard 2 took about 3. The two halves take about the same time locally
(10s and 13s). No timeout, deadline or test assertion changed.
