# AIOS v1 implementation ticket breakdown — draft

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Status: superseded — published implementation tickets exist at ../aios-v1-implementation/README.md

Source: [approved specification](spec.md). Proposed publication: one ticket per file in a separate `aios-v1-implementation` local tracker effort, leaving the resolved wayfinder tickets and parent specification unchanged.

Each slice is verified through the approved public-controller testing boundary. Controlled adapters, real temporary Git repositories and reopened SQLite state provide demonstrations before live infrastructure is qualified. Unimplemented or unqualified phases remain blocked; intermediate slices must not claim the full delivery is complete or enable live pilot writes. Every external-effect slice includes its own uncertainty/restart tests; final host qualification is additional evidence, not a late replacement for recovery tests.

1. **Submit a feature request and inspect durable delivery status**
   - **Blocked by:** None.
   - **What it delivers:** A TypeScript CLI accepts repository/request/optional issue input, creates a durable delivery identity and returns status/evidence after restart. Not-yet-enabled phases stop explicitly rather than perform effects.
   - **Acceptance focus:** Real SQLite persistence and artifacts, initial phase/blocker, CLI error handling, secret-safe reporting, preserved existing repository material and reproducible runtime/test bootstrap.

2. **Report repository onboarding readiness without changing setup**
   - **Blocked by:** Submit a feature request and inspect durable delivery status.
   - **What it delivers:** A request verifies canonical identity and trusted Factory/owner policy and reports missing App, signing, review, check or infrastructure prerequisites before writes.
   - **Acceptance focus:** Profile-page identity discrepancy, candidate policy weakening, version provenance, live unknown versus verified evidence, actionable checklist, no provisioning or credentials in reports.

3. **Queue, pause, cancel and recover repository-owned deliveries**
   - **Blocked by:** Submit a feature request and inspect durable delivery status.
   - **What it delivers:** Public commands coordinate one active delivery per repository, preserve work and recover ownership/state after interruption, with independent repositories able to proceed.
   - **Acceptance focus:** Lease fencing, queued requests, paused/cancelled/blocker states, explicit session IDs, no new effects after stop, orphan uncertainty and crash recovery through controlled adapters.

4. **Launch an isolated worker with a fail-closed qualification gate**
   - **Blocked by:** Report repository onboarding readiness without changing setup; Queue, pause, cancel and recover repository-owned deliveries.
   - **What it delivers:** A controller-run sandbox qualification probe starts/stops a pinned microVM worker only under explicit host and model-only policy, records evidence and refuses unsafe fallback.
   - **Acceptance focus:** Ordinary-file admission, no Git metadata/owner credentials/SSH/skills/MCP/host hooks, effective network and proxy configuration, cross-delivery denial, pinned versions, descendant lifecycle controls. No readiness claim from mocked probes.

5. **Implement a bounded feature and safely admit the worker result**
   - **Blocked by:** Launch an isolated worker with a fail-closed qualification gate.
   - **What it delivers:** The request produces observable acceptance criteria, an isolated Codex session, a feature branch and safely imported candidate changes without publication.
   - **Acceptance focus:** Material ambiguity, initial 120-minute allowance and extension, structured adapter errors, explicit resume identity, policy recheck, stopped-worker import, malicious path/link/Git-hook rejection and tested-tree identity.

6. **Validate baseline and candidate behavior inside isolation**
   - **Blocked by:** Implement a bounded feature and safely admit the worker result.
   - **What it delivers:** Delivery runs declared unchanged-main baseline checks before coding and the final candidate's format/lint/type/coverage/build/feature checks afterward, producing exact-revision evidence or blockers.
   - **Acceptance focus:** Controlled dependency access, disposable synthetic E2E resources, no privileged host-script execution, formatting followed by verification, baseline scope control, required-check outcomes, timeout and one diagnostic flake rerun. Initial worker flow is gated on this validation before live delivery.

7. **Repair validation findings within persisted allowances**
   - **Blocked by:** Validate baseline and candidate behavior inside isolation.
   - **What it delivers:** Failed candidate validation returns a batch of findings to the isolated worker, revalidates the fix and either advances or preserves a budget-backed blocker.
   - **Acceptance focus:** Three cycles/60 active repair minutes, excluded waits, no weakening tests/policy, no allowance reset on restart, explicit extension and traceable results for each attempt.

8. **Publish signed code and create an App-authored PR**
   - **Blocked by:** Repair validation findings within persisted allowances.
   - **What it delivers:** A validated candidate is signed through the trusted Git identity, pushed with recorded provenance and proposed as a Factory App PR, with the owner still eligible to review.
   - **Acceptance focus:** Cross-platform trusted authentication adapter, signature verification, scoped identity, no worker credentials, local evidence bound to committed tree, intent/outcome journaling and reconciliation after uncertain push/PR creation. Controlled fixtures verify behavior before live readiness.

9. **Monitor trusted PR checks for the current revision**
   - **Blocked by:** Publish signed code and create an App-authored PR.
   - **What it delivers:** PR status advances only on successful expected-publisher evidence for the exact head; failures return repair findings and missing or stalled checks produce clear blockers.
   - **Acceptance focus:** Required names and provenance, skipped/neutral/stale/spoofed results, configured/default 60-minute phase timeout, retry history, new-head evidence invalidation and resumed waits.

10. **Address review findings and wait for owner approval**
    - **Blocked by:** Monitor trusted PR checks for the current revision.
    - **What it delivers:** Straightforward review fixes use the repair/validation/publication loop; disputed findings stay open; only the sole owner's current-head approval enables the merge phase.
    - **Acceptance focus:** Verified conversation resolution, bot/self/stale/dismissed/changes-requested review rejection, no submitted approval, no deadline or repeated reminders, new-head invalidation and cumulative repair accounting.

11. **Merge only the validated and owner-approved head**
    - **Blocked by:** Address review findings and wait for owner approval.
    - **What it delivers:** The controller rechecks head/base/checks/reviews at the boundary and conditionally merges the authorized revision, preserving evidence and uncertainty.
    - **Acceptance focus:** Head/base races, renewed approval after refresh commits, branch protection, no bypass, expected-head condition, consumed repair allowance and post-acceptance crash reconciliation.

12. **Verify merged main and block unsafe recovery**
    - **Blocked by:** Merge only the validated and owner-approved head.
    - **What it delivers:** A merged PR remains incomplete until declared main checks including E2E pass; failure produces evidence and blocks downstream cleanup.
    - **Acceptance focus:** Actual merged/main revision, main advancement, expected check provenance, wait limits, no direct-main fix/revert, new owner-approved PR requirement and restart-safe monitoring.

13. **Synchronize clean local main without losing work**
    - **Blocked by:** Verify merged main and block unsafe recovery.
    - **What it delivers:** Current references and passed-main evidence allow a clean local main to fast-forward and report the recorded alignment; dirty/divergent work is preserved with a blocker.
    - **Acceptance focus:** Local-only commits, uncommitted files, remote identity/state changes, no stash/reset/rebase/force-push, safe Git configuration and observable synchronization progress.

14. **Clean eligible merged branches and report delivery completion**
    - **Blocked by:** Synchronize clean local main without losing work.
    - **What it delivers:** The controller evaluates all local/remote non-main tips, preserves documented exclusions, conditionally removes proven merged branches and declares completion only when eligible cleanup succeeds.
    - **Acceptance focus:** Ordinary/squash/rebase evidence, unrelated merged branches, newer/local-only commits, protected/replay/worktree retention, deletion races, independent local/remote outcomes and restart of partial cleanup without repeated merge.

15. **Qualify the complete controller boundary on Windows**
    - **Blocked by:** Clean eligible merged branches and report delivery completion.
    - **What it delivers:** A Windows 11 x64 qualification run drives the public controller and adversarial host probes, emits a version-bound readiness record or actionable failure, and enables only proven host behavior.
    - **Acceptance focus:** Real microVM/network/credential exclusion, signed identity and trusted adapters, dependency/E2E operation, malicious input/output, process descendants/orphans, restart/resume and secret-canary evidence. Unavailable infrastructure is blocked/not-run, never passed.

16. **Qualify the complete controller boundary on macOS**
    - **Blocked by:** Clean eligible merged branches and report delivery completion.
    - **What it delivers:** The same public workflow and isolation matrix runs on macOS 14+ Apple silicon, producing independent host qualification rather than inheriting Windows evidence.
    - **Acceptance focus:** Native signing/authentication, path/link behavior, microVM/network controls, cancellation/orphans, resumed isolation, complete validation and explicit version/policy identity. No implicit PowerShell or Windows key-path assumption.

17. **Demonstrate an observed profile-page pilot delivery**
    - **Blocked by:** Qualify the complete controller boundary on Windows; Qualify the complete controller boundary on macOS.
    - **What it delivers:** One owner-agreed small feature completes the selected repository's actual onboarding, signed push, App PR, validation, human review, protected merge, main checks, synchronization and eligible cleanup with an evidence bundle.
    - **Acceptance focus:** Live canonical identity, effective protections/check names and App installation, actual signature/owner-review evidence, no provision-by-delivery or production-test credentials, complete versus blocked reporting. Component tests cannot replace this observed acceptance.

Review requested: is the granularity appropriate, do the blocking edges represent real prerequisites, and should any slice be merged or split? No implementation tickets have been published yet.
