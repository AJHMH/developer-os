# Developer AIOS v1: owner-approved feature delivery

Status: ready-for-agent
Testing seam: owner-approved on 7 October 2026

## Problem Statement

The repository owner wants to hand a feature request to an agent and receive a verified delivery, rather than supervise branch creation, coding, formatting, lint, tests, PR preparation, check monitoring, review fixes, merge, synchronization and cleanup separately. Coding alone does not complete the task. The owner must remain the sole human approver, code must be signed, and failures or interruptions must preserve work rather than bypass checks or lose state.

The existing Software Factory supplies narrower identity and governance capabilities. It does not yet provide this complete autonomous delivery controller, a qualified isolated Codex worker, or verified onboarding for the selected pilot. AIOS must connect those capabilities without giving untrusted repository code access to owner credentials or allowing feature branches to weaken their own gates.

## Solution

A local TypeScript foreground CLI accepts a personal repository and written feature request, optionally linked to an issue. A trusted delivery controller drafts feature acceptance criteria, creates a feature branch, delegates implementation to an isolated coding worker, validates the result, publishes signed code and creates a Software Factory App-authored PR. It monitors checks and review, repairs permitted findings within bounded allowances, and waits for the owner's actual GitHub approval of the final head.

After rechecking all gates, the controller merges only the validated and approved revision, verifies main, safely synchronizes local main and removes eligible merged branches. It reports completed delivery with evidence, or a delivery blocker with preserved progress and a precise next action. Restart, pause and cancellation retain authority boundaries and budget usage.

V1 supports the controller on Windows 11 Intel/AMD x64 with Windows Hypervisor Platform and macOS 14+ Apple silicon. A pinned Docker Sandboxes microVM hosts a pinned Codex CLI and Linux-isolated web-app validation. Each host must pass qualification before worker execution is enabled. The initial pilot is `AJHMH/profile-page`; neither configuration inspection nor this specification establishes pilot readiness.

## User Stories

1. As a repository owner, I want to submit a repository and written feature request through a local CLI, so that I can delegate delivery from one entry point.
2. As a repository owner, I want an optional issue reference, so that delivered work retains its original context.
3. As a repository owner, I want observable feature acceptance criteria drafted before coding, so that completion means the requested behavior works.
4. As a repository owner, I want questions only for materially ambiguous requirements, so that routine delivery does not require continual supervision.
5. As a repository owner, I want canonical repository identity verified, so that saved remotes cannot redirect delivery to the wrong repository.
6. As a repository owner, I want an onboarding checklist when prerequisites are missing, so that setup remains separate from feature delivery.
7. As a repository owner, I want trusted Factory and policy versions pinned, so that a candidate cannot change the authority judging its own work.
8. As a repository owner, I want signing tested locally and on GitHub, so that signed-code requirements are demonstrated rather than inferred from settings.
9. As a repository owner, I want one active delivery per repository, so that concurrent agents do not race over branches or state.
10. As a repository owner, I want independent repositories to run separately, so that an approval wait need not block unrelated work.
11. As a repository owner, I want code changes made on a feature branch, so that main is never the worker's editing target.
12. As a repository owner, I want a coding worker with isolated files and capabilities, so that repository code cannot reach my credentials or other work.
13. As a repository owner, I want worker isolation qualified on both supported hosts, so that a working Windows setup does not imply macOS readiness.
14. As a repository owner, I want model-only authentication and spending limits, so that inference authority is separate from repository publication authority.
15. As a repository owner, I want dependency scripts and validation to run inside isolation, so that checking the code does not expose the controller host.
16. As a repository owner, I want synthetic disposable database-backed E2E resources, so that feature verification does not need production credentials.
17. As a repository owner, I want unchanged-main baseline failures identified, so that unrelated repairs are not silently added to my feature.
18. As a repository owner, I want formatting, lint, type checks, coverage, build and feature verification run where declared, so that hook success alone cannot masquerade as completion.
19. As a repository owner, I want browser/database tests when the feature requires them, so that generic smoke checks do not substitute for behavioral evidence.
20. As a repository owner, I want results tied to exact revisions and trusted publishers, so that stale or spoofed green checks cannot authorize merge.
21. As a repository owner, I want missing, skipped and neutral required checks treated as incomplete, so that absent verification is visible.
22. As a repository owner, I want failures and reruns preserved, so that a passing retry does not conceal an unexplained flake.
23. As a repository owner, I want tests and thresholds protected from weakening, so that the agent fixes code instead of manufacturing success.
24. As a repository owner, I want the App to author PRs while my configured identity publishes signed commits, so that I can remain the sole eligible human reviewer.
25. As a repository owner, I want straightforward review findings repaired and verified, so that resolved conversations correspond to completed fixes.
26. As a repository owner, I want disputed review requests escalated without premature resolution, so that acceptance criteria and policy remain under my authority.
27. As a repository owner, I want my current-head GitHub APPROVED review to authorize merge, so that I need not provide a redundant merge command.
28. As a repository owner, I want new commits to invalidate approval, so that only the code I reviewed can merge.
29. As a repository owner, I want agent credentials never to submit my approval, so that human review remains independent.
30. As a repository owner, I want bounded implementation and repair allowances, so that difficult tasks stop with preserved progress instead of running indefinitely.
31. As a repository owner, I want explicit allowance extensions, so that I decide when blocked work should continue.
32. As a repository owner, I want CI waits bounded but approval waits unhurried, so that stalled automation is reported without repeated approval reminders.
33. As a repository owner, I want delivery status and evidence available during waits, so that I can inspect progress without changing execution.
34. As a repository owner, I want pause to preserve resumable work, so that I can suspend a delivery safely.
35. As a repository owner, I want cancellation to stop new actions without deleting work, so that stopping execution is not an implicit rollback.
36. As a repository owner, I want restart to reconcile uncertain effects before continuing, so that an interrupted response does not duplicate a PR or merge.
37. As a repository owner, I want budget usage and explicit worker session identity to survive restart, so that a new process cannot reset limits or resume the wrong task.
38. As a repository owner, I want approval, checks and head/base revalidated at merge, so that racing updates cannot land unreviewed code.
39. As a repository owner, I want main checks verified after merge, so that successful PR checks do not prematurely end delivery.
40. As a repository owner, I want post-merge repairs or reverts to use a new signed PR and approval, so that failure recovery does not bypass review.
41. As a repository owner, I want clean local main fast-forwarded without rewriting history, so that synchronization preserves my work.
42. As a repository owner, I want dirty or divergent main reported as a blocker, so that automatic cleanup cannot discard local changes.
43. As a repository owner, I want all eligible local and remote merged branches considered, including unrelated ones, so that repository cleanup follows my standing policy.
44. As a repository owner, I want squash/rebase deletion based on reliable PR/head/merge linkage, so that cleanup does not depend on misleading ancestry alone.
45. As a repository owner, I want newer branch commits and local-only work preserved, so that an old merged PR cannot justify deleting new work.
46. As a repository owner, I want protected, replay-retained and active-worktree branches retained with reasons, so that valid exclusions do not appear as failed cleanup.
47. As a repository owner, I want deletion conditioned on the evaluated tip, so that a concurrent branch update cannot be deleted blindly.
48. As a repository owner, I want partial cleanup recorded and resumable, so that retrying cleanup does not repeat the feature merge.
49. As a repository owner, I want a completion or blocker report with revisions and evidence, so that I can assess the delivered result and required next action.
50. As a repository owner, I want logs and artifacts to exclude credentials, so that observability does not create another secret store.

## Implementation Decisions

### Controller and public contract

- Build one foreground TypeScript controller; do not add an always-running daemon or multiple orchestration frameworks. Use a qualified supported Node runtime compatible with the adopted Factory adapters. Select and record exact dependency/runtime pins during qualification.
- The public command boundary provides start, status, pause, resume and cancel. Start accepts canonical repository input, written feature request, optional issue linkage and declared allowances. Status returns delivery phase, revisions, evidence, usage, pending owner action and blocker reason. Pause/resume/cancel address an explicit delivery identity. Allowance extension is an explicit owner action recorded with the changed limit; it cannot be requested by worker output.
- The running controller owns effects. Control invocations coordinate through a host-local trusted channel and transactional durable state, not a competing worker. Repository ownership uses a durable lease with fencing/reconciliation; a stale lease does not authorize overlapping work. Waiting, paused and blocked deliveries retain ownership until finished or explicitly released without violating the single-active-delivery rule.
- Normal phases are queued, preparing, implementing, validating, waiting-checks/review, waiting-approval, merging, verifying-main, synchronizing/cleanup and completed. Repairing returns to validation. Paused, cancelled and blocked preserve the prior phase and work. A restart does not clear those states automatically.

### State and evidence

- SQLite is the local transactional ledger; separate artifact/log storage retains sources, outputs and verification evidence. Define schema migration, synchronization/durability settings and backup handling; WAL is not a zero-loss claim.
- Records cover repository identity/onboarding, delivery request/criteria/phase, repository ownership, trusted policy and host qualification, worker/sandbox session identity, exact revisions, allowance usage/extensions, validation attempts, reviews, proposed effects/outcomes and cleanup eligibility/results.
- An effect record carries delivery and operation identity, expected revision/resource, policy version, dispatch state and outcome: proposed, dispatched, succeeded, failed or uncertain. Persist intent before dispatch and result afterward. Reconciliation distinguishes success from uncertainty; no exactly-once claim is made for external systems.
- Evidence records identify phase, tested tree/revision, command/check identity, trusted publisher/workflow, timestamps, outcome, retry history and artifact references. Logs redact credentials and do not claim hidden-reasoning access. Record append history without claiming immutability against the host owner.

### Onboarding and trusted authority

- Only explicitly onboarded personal repositories may perform remote delivery effects. Verify canonical remote/default branch, pinned Factory and owner policy, sole eligible owner approver, App installation, configured signing and publication identity, effective protections/checks and validation infrastructure. Missing prerequisites produce a precise checklist and stop delivery; provisioning is separate.
- Initial target is `AJHMH/profile-page`. Its saved local origin differs; verify the intended identity before any write and never silently rewrite or substitute it.
- Keep Factory App credentials limited to the adopted PR-operation scope. The external App PEM authenticates the App; it is not a commit-signing key. Configured owner Git/GitHub credentials perform signed pushes and post-approval merge, scoped to onboarded repositories. Verify local signing and GitHub verified signatures. Never submit human APPROVED reviews with either identity.
- Reuse Factory PR authentication, trusted review refresh and governance evaluation within their verified scope. Implement/test equivalent trusted cross-platform adapters rather than assume a Windows-specific helper works on macOS. Candidate-controlled policy, scripts or evidence cannot redefine the authority evaluating that candidate.

### Worker and host boundary

- Wrap a pinned, tested Codex CLI behind a replaceable coding adapter. Its contract covers start, structured events/results, explicit session resume, pause/stop and outcome reconciliation. Validate actual event/exit behavior and resumed isolation; installed CLI help is not qualification. Do not resume using global last-session selection.
- Evaluate pinned Docker Sandboxes microVMs on Windows 11 Intel/AMD x64 with Windows Hypervisor Platform and macOS 14+ Apple silicon. Required qualification applies independently on each host. Unsupported, changed or unverifiable runtime/policy combinations refuse launch. No implicit host-worker or weaker-container fallback.
- Materialize only admitted ordinary files from the selected revision into a fresh worker workspace. Keep trusted Git metadata, owner environment files, home/keystore, credential helpers, signing/SSH sockets, controller state and host Docker authority outside it. Reject linked/reparse/escaping inputs and unsafe outputs. Stop the worker before importing output to avoid concurrent-write races.
- Disable host MCP, shared skills, SSH forwarding, repository host hooks and unreviewed credentials/network integrations. A dedicated model-only proxy identity has restricted provider endpoints and spend controls. Dependency access uses declared registries or prepared caches in a controlled phase. No GitHub binding or production credentials enter the worker.
- Execute all repository-controlled dependency scripts and validation inside isolation, including controller-requested revalidation. Never run worker-modified scripts on the credential-bearing controller host. Import changes through safe file operations into trusted Git context; sanitized trusted Git configuration prevents candidate hooks/configuration from executing during signing/publication.
- Linux-isolated validation is the web-app baseline on both hosts. Disposable synthetic database/browser resources support E2E within isolation. Native application compatibility is not inferred from the controller host. Effective networking, mounts, model auth, descendant termination and orphan/resume behavior must pass adversarial tests.

### Validation and review

- Draft feature acceptance criteria and relevant tests before coding; ask only when ambiguity materially changes the result. Do not mistake general smoke tests, hook success or coverage percentage for feature correctness.
- Onboarding declares local, PR and main checks, trusted publishers, timeouts and explicitly permitted exceptions. Validate unchanged main before feature work; unrelated baseline failures block and require owner scope expansion before repair.
- Pilot local baseline consists of lint/format verification, type checking, coverage and build, plus feature-specific verification. Browser/database behavior requires relevant local E2E. Existing hosted PR checks and required Factory gates follow onboarding declarations; hosted main checks include the pilot's E2E.
- Local results bind the tested tree to the final candidate commit. Hosted results bind the exact PR/main revision to expected trusted workflows. Output changes invalidate affected evidence. Applying formatting is a code change followed by verification, not itself evidence of success.
- Required checks pass only with successful trusted evidence. Missing, pending, skipped, neutral, cancelled, stale and untrusted results remain incomplete unless owner-controlled policy explicitly permits an exception. Preserve every failed attempt and automatic/manual rerun outcome.
- Allow one diagnostic rerun on unchanged code. Passing the rerun does not explain the earlier failure; unexplained intermittency blocks unless an owner-approved flake policy covers it. Never weaken tests, lower thresholds, skip gates or alter policy to get green results.
- Fix straightforward review findings and verify them before resolving conversations. Disputed or conflicting requests remain open and go to the owner. Review text and worker proposals are untrusted inputs, not authority to expand scope or credentials.

### Limits, waiting and recovery

- Initial implementation defaults to 120 active minutes, configurable. Repair defaults to three cycles or 60 active repair minutes, whichever is exhausted first. A repair cycle attempts one batch of validation/review fixes with relevant revalidation; initial coding is not a cycle. New comments and restarts do not reset limits.
- Persist diagnosis/editing/local-revalidation time during repair. Exclude initial implementation from repair time; exclude CI/approval waits, pauses and downtime from active allowances. Exhaustion preserves work and blocks further applicable work until explicit owner extension.
- Use declared command/check timeouts and a 60-minute default per CI phase. Timeout produces a blocker with evidence. Approval waits have no deadline and no repeated reminders. A hung command must be stopped or reconciled before another attempt overlaps it.
- Pause stops new dispatch at a safe boundary and preserves resumable state. Cancel stops new effects and retains branch, PR and evidence; it does not automatically undo, close or delete them. Dispatched actions may complete and must be observed without authorizing subsequent work.
- Restart checks durable state, repository ownership and orphaned sandbox processes, requalifies relevant authority, and reconciles uncertain local/remote outcomes. Resume eligible previously running work only. Explicitly paused/cancelled deliveries remain stopped; a blocked delivery requires its blocker to be addressed.

### Merge, main and cleanup

- Owner current-head GitHub APPROVED review is merge authorization once checks/conversations pass; no separate go-ahead is required. New head commits require renewed owner review. Reject bot/self/stale/dismissed reviews and outstanding required changes under trusted policy.
- Immediately before merge recheck head/base, reviews, trusted required checks and conversations. Merge uses the expected approved head as a condition. If main advances, refresh the branch and applicable checks; any new PR commit invalidates approval. Races or exhausted repair allowance block rather than bypass gates.
- After merge verify the actual merged/main revision. Main failure stops progression; a fix/revert must use a new signed PR and owner approval. Do not report completion or automatically rewrite main.
- Fetch current references and verify identity, checkout and main. Fast-forward clean local main only. Uncommitted changes, local-only main commits or divergence block synchronization; no automatic stash, reset, rebase, force-push or discard.
- Inspect every local and remote non-main branch, including unrelated merged ones. Record eligible, retained or blocked with tip and reason. Preserve protected, Factory replay/event and active-worktree branches as expected retention. Unmerged branches require an explicit owner deletion decision outside automatic cleanup.
- Ordinary ancestry can establish merge integration. Squash/rebase cases require reliable PR evidence linking the unchanged current branch head to a merged result present on main. Evaluate local/remote tips separately; newer commits invalidate older merge evidence.
- Retain eligibility evidence before deletion and condition deletion on the evaluated tip, current policy and worktree state. Git conditional-reference operations or equivalent controls must prevent deletion of a different tip; unsupported controls block rather than fall back to blind deletion. Reconcile uncertain outcomes and record local/remote progress independently.
- Completion requires passing applicable main checks, local/remote main alignment at a recorded observation and all eligible cleanup finished. Retention is expected; unsafe synchronization, unknown eligibility or failed eligible deletion blocks. Resume partial cleanup without recreating PRs or repeating merge. Reports state the checked/synchronized revision, deleted/retained branches and unresolved evidence.

## Testing Decisions

### Primary testing seam

The proposed primary seam is the public delivery-controller command and observation contract. Tests submit requests/control actions, provide controlled external observations and assert resulting status, evidence and permitted effects. GitHub, Git/signing, sandbox/worker, storage, clock and crash injection are replaceable boundary adapters, not independent test APIs added throughout business logic.

Use deterministic adapters for most lifecycle tests and real temporary Git repositories when branch/history behavior matters. Reopen the real ledger for restart tests. Host qualification and the observed pilot drive the same controller through real adapters. Separate adversarial host probes are necessary evidence for isolation; mocked controller behavior cannot prove it.

There is no runtime or analogous test suite in this repository. Existing Factory behavior provides review/protection and constrained-effect prior art; pilot test suites supply application validation evidence, not proof of controller correctness. Good tests assert external results and forbidden-effect absence, not private methods, table layouts or incidental event order.

### Required behavioral scenarios

1. A fully qualified delivery reaches completed only after signed publication, App PR identity, exact-head owner review, all required checks, conditional merge, main verification, safe synchronization and eligible cleanup.
2. Missing onboarding or host qualification blocks before worker launch or remote writes with an actionable checklist.
3. A feature branch cannot weaken policy, counterfeit trusted checks, submit owner approval or direct privileged actions through review/tool text.
4. Initial criteria handle ordinary requests without redundant questioning and block materially ambiguous requirements.
5. Baseline failure, stale evidence, skipped/missing checks and unexplained flakes prevent merge; failed attempts remain visible.
6. Two deliveries for one repository cannot overlap, including stale-owner crash recovery; distinct repositories can proceed independently.
7. Initial allowance, repair cycle/time and CI timeout boundaries hold across restarts; waits do not reset usage or consume excluded time. Explicit extension resumes only the relevant blocked work.
8. Pause/cancel stops new dispatch, retains artifacts and verifies sandbox descendants stop or reports uncertainty. In-flight remote completion is reconciled without new work.
9. Crash injection before dispatch, after external acceptance and before local outcome commit does not blindly duplicate push, PR creation, merge or deletion. Inconclusive reconciliation blocks.
10. Current-head approval succeeds; stale/dismissed/bot/self approval and outstanding changes fail. New commits require refreshed checks and human review.
11. Head/base races at merge cannot land an unvalidated head. Updating the branch retains budget usage and invalidates approval when appropriate.
12. Main E2E failure stops cleanup and does not trigger direct-main fixes or automatic revert.
13. Dirty/divergent local main preserves work; clean main fast-forwards and verifies the recorded remote observation.
14. Ordinary/squash/rebase merge evidence permits only covered tips; newer commits, remote/local tip differences and uncertain integration preserve work.
15. Protected/replay/worktree retention is successful exclusion; deletion races and partial failures produce resumable blockers without repeated merge.
16. Logs, reports and artifacts exclude secret canaries while retaining revision and outcome provenance.

### Host qualification and pilot acceptance

Both target host configurations must pass real isolation tests: host-file/state exclusion; credential/helper/signing-socket denial; restricted network and model-only auth; malicious dependency/configuration containment; safe input/output paths; cross-delivery isolation; complete validation inside isolation; explicit resume; and verified descendant/orphan stopping. Pin effective configuration and runtime/worker versions with the evidence. All such tests are currently unperformed.

Pilot acceptance is one owner-agreed small feature delivered end to end in the selected repository with observed evidence for every gate. Signing, credential use, App authorship and governance require live verification rather than mocks. A Windows result does not qualify macOS. Tests requiring inaccessible host/infrastructure report blocked/not-run, never passed. Failures of the selected sandbox candidate trigger a review of the accepted architecture rather than silent substitution.

## Out of Scope

- Shared-team/multi-user operation, general desktop automation, additional agent workloads and distributed multi-agent infrastructure.
- Always-on service scheduling, Linux controller support, Intel Macs and Windows ARM in v1.
- Native Windows/macOS application compatibility inferred from Linux web-app checks.
- Agents approving as the owner, bypassing protections, weakening validation, automatically changing governance or provisioning missing prerequisites during feature delivery.
- Automatic unmerged-branch deletion, replay-evidence migration, discarding local work or direct-main post-merge repair/revert.
- Credential-bearing host execution of repository scripts, uncontrolled dependency networking or fallback from an unqualified sandbox.
- A custom inference engine, transparent inference preemption, lossless model memory or exactly-once guarantees for external services.

## Further Notes

This specification synthesizes the owner-confirmed [decision map](map.md) and its resolved decisions: [Factory onboarding](issues/01-factory-onboarding.md), [validation/review](issues/02-validation-review-contract.md), [lifecycle/recovery](issues/03-delivery-lifecycle.md), [synchronization/cleanup](issues/04-main-sync-cleanup.md), [runtime foundation](issues/05-runtime-foundation.md), and [isolation investigation](issues/06-worker-isolation.md). Supporting evidence is in [Factory integration](factory-evidence.md), [pilot readiness](pilot-readiness.md), [worker isolation research](worker-isolation-research.md), and the [AIOS research synthesis](../../AIOS-RESEARCH.md).

Exact qualified runtime/worker/Factory pins, effective hosted check names and current App/ruleset/signing state are qualification deliverables. No host or pilot is enabled by approval of this specification. The selected pilot feature is agreed at execution intake using the acceptance-criteria contract. Repository setup, qualification and implementation are subsequent work; this document performs no installation, credential change, PR creation, merge or branch deletion.

The repository has no initial Git commit and its existing files are uncommitted. Preserve user material when implementation begins; do not assume a usable base branch or research snapshot already exists. Implementation ticket generation must keep these resolved planning tickets separate from new delivery slices.

The owner confirmed the proposed testing seam on 7 October 2026. This canonical specification is published with local `ready-for-agent` status. Continue with `/to-tickets`; do not triage already agent-ready work or start implementation as part of specification synthesis.
