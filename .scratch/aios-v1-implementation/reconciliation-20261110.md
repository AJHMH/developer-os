# v1 ticket and story reconciliation, 10 November 2026

This file reconciles every ticket in this folder and every user story in the
[canonical specification](../aios-feature-delivery/spec.md) against `main` at
`86a93ed` and the Mac runs recorded below. It replaces the 15 October status in
the [README](README.md). The open tickets now live in GitHub, under
[Spec: Finish Developer AIOS v1 on the Mac (#263)](https://github.com/AJHMH/developer-os/issues/263),
and each keeps its v1 number.

## Evidence used

- **Worker qualification**, `observed-offline-worker-qualification`, 10
  November 2026, at `main` `15c27ef`, on the final Claude Code guest
  `c5a7a034…` ([worker qualification](../../docs/worker-qualification.md)).
- **Session acceptance**, `observed-offline-session-acceptance`: 26 stages, at
  `4a867bf` ([macOS worker qualification](../../docs/macos-worker-qualification.md)).
- **Metered CLI delivery acceptance**, `observed-metered-cli-delivery-acceptance`:
  the candidate validated 6 of 6 for $0.069
  ([feature candidate](../../docs/feature-candidate.md)).
- **The CLI's own statement:** every stage from `publish-feature` to
  `cleanup-branches` installs its native adapter from the owner's records,
  and production delivery stays disabled (`src/cli.ts`).

"Native" below means observed on the Mac through the real CLI or runtime.
"Controlled" means implemented and tested only against test stand-ins.

## Tickets

There are 25 tickets, 01 to 25.

| Ticket                           | Status                                                         | Where it stands                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Durable request and status    | Completed                                                      | Native: `start` and `status`.                                                                                                                           |
| 02 Onboarding readiness          | Completed                                                      | Onboarding facts the CLI can't observe are owner-attested (ADR 0004).                                                                                   |
| 03 Ownership, pause and recovery | Completed                                                      | Native pause, cancel and recover reach the exact coding session.                                                                                        |
| 04 Isolated worker gate | Completed in #277 ([#264](https://github.com/AJHMH/developer-os/issues/264), closed after this reconciliation) | Production admission and ADR 0009 (story 51). The dependency phase moved to #265. |
| 05 Bounded feature candidate     | Completed                                                      | The last criterion, the pinned CLI adapter with structured events and explicit resume, is met by Claude Code: the session and CLI delivery acceptances. |
| 06 Isolated validation           | Open, [#265](https://github.com/AJHMH/developer-os/issues/265) | Native baseline and candidate validation, dependency installs with install scripts, a disposable database per E2E check and browser E2E checks in the admitted Playwright image (11 November receipts). Both acceptance items are proven natively. |
| 07 Validation repair             | Open, [#266](https://github.com/AJHMH/developer-os/issues/266) | Native: `repair-feature` repaired a failing candidate on Claude Code, with cycle, active-time and spend accounting and the exhausted refusal ([11 November receipt](ticket07-macos-repair-acceptance-receipt.md)). |
| 08 Signed App publication        | Open, [#267](https://github.com/AJHMH/developer-os/issues/267) | Native: the owner's key signs through ssh-agent, the owner pushes, GitHub verifies, the App opens the PR ([11 November receipt](ticket08-macos-publication-acceptance-receipt.md)), and the [first real delivery](first-real-delivery-receipt.md) published through `publish-feature` (12 November). |
| 09 Trusted PR checks             | Open, [#268](https://github.com/AJHMH/developer-os/issues/268) | Native monitor: a passing and a failing `pr-ci` run, and a receipted rerun that keeps the failure ([12 November receipt](ticket09-macos-pr-checks-acceptance-receipt.md)); the [first real delivery](first-real-delivery-receipt.md) passed `monitor-pr-checks`. |
| 10 Review and owner approval     | Open, [#269](https://github.com/AJHMH/developer-os/issues/269) | Native adapter: ungated, gated, the owner's 👍 finding resolved, then exact-head approval ([12 November receipt](ticket10-macos-review-acceptance-receipt.md)); the [first real delivery](first-real-delivery-receipt.md) reached `ready-to-merge` through `monitor-review`, ungated. |
| 11 Conditional merge             | Open, [#270](https://github.com/AJHMH/developer-os/issues/270) | Native fast-forward merge: a real delivery merged through `merge-feature`, main fast-forwarded to its exact head with a lease on the base, PR merged, reconciled once ([12 November receipt](ticket11-macos-merge-delivery-receipt.md)). |
| 12 Merged main verification      | Open, [#271](https://github.com/AJHMH/developer-os/issues/271) | Native main observer: a real delivery merged, then `monitor-main-checks` verified main through its own `main-ci` push run ([12 November receipt](ticket12-macos-main-delivery-receipt.md)). That delivery's candidate changed nothing, yet published; a follow-up. |
| 13 Safe main sync                | Open, [#272](https://github.com/AJHMH/developer-os/issues/272) | Native main sync: a real delivery merged, main was verified, then `sync-main` fast-forwarded the delivery's checkout to exactly that revision ([13 November receipt](ticket13-macos-sync-delivery-receipt.md)). |
| 14 Cleanup and completion        | Open, [#273](https://github.com/AJHMH/developer-os/issues/273) | Native cleanup: a real delivery merged, verified and synchronized main, then `cleanup-branches` deleted every merged branch, kept the unmerged ones and completed the delivery ([13 November receipt](ticket14-macos-cleanup-delivery-receipt.md)). |
| 15 Windows qualification         | Superseded                                                     | ADR 0007: the Mac is the only owner host.                                                                                                               |
| 16 macOS qualification           | Open, [#274](https://github.com/AJHMH/developer-os/issues/274) | Native: the complete qualification combined the worker, session, validation, lifecycle and delivery-through-cleanup runs from one revision, and all ten boundaries passed; the production admission is at the `complete` level ([13 November receipt](ticket16-macos-complete-qualification-receipt.md)). |
| 17 Observed profile-page pilot   | Open, [#275](https://github.com/AJHMH/developer-os/issues/275) | Never run.                                                                                                                                              |
| 18 Pinned Windows VM             | Completed, then removed                                        | Windows support was removed in #226 (ADR 0007).                                                                                                         |
| 19 Offline delivery canary       | Completed, then removed                                        | The fixed worker was removed in #256.                                                                                                                   |
| 20 Positive-control isolation    | Completed, then removed                                        | Fixed worker removed. Today's boundary probe covers the general workers.                                                                                |
| 21 Subscription mediation        | Completed, then removed                                        | The ChatGPT layer was removed in #255 (ADRs 0006 and 0008).                                                                                             |
| 22 Online access and usage gate  | Superseded                                                     | The spend budget replaces the usage gate (ADR 0008).                                                                                                    |
| 23 VM fencing and recovery       | Completed, then removed                                        | Fixed worker removed. Coding-session fencing and recovery passed in the session acceptance.                                                             |
| 24 Windows worker qualification  | Completed, then removed                                        | Windows removed.                                                                                                                                        |
| 25 macOS worker qualification    | Completed, then removed                                        | Fixed worker removed. The Claude Code worker qualification replaces it.                                                                                 |

So 4 tickets are completed and still current (01, 02, 03, 05). 7 were completed
for code that has since been removed, 2 are superseded, and 12 are open.

## User stories

There are 56 stories. Their status:

- **Done:** met natively on the Mac.
- **Done, changed:** met in the form a later ADR gave it.
- **Partial:** part is met natively, and the rest is named.
- **Controlled only:** built and tested, never run natively.
- **Not done.**

| #   | Story (short)                                             | Tickets            | Status                                                                                                                                              |
| --- | --------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Submit through a local CLI                                | 01, 17             | Done                                                                                                                                                |
| 2   | Optional issue reference                                  | 01                 | Done (`--issue`)                                                                                                                                    |
| 3   | Criteria drafted before coding                            | 05                 | Done, changed: the owner writes the criteria file (ADR 0004)                                                                                        |
| 4   | Questions only for real ambiguity                         | 05                 | Done (`clarify-feature`)                                                                                                                            |
| 5   | Canonical repository identity verified                    | 02                 | Partial: some onboarding facts are owner-attested (ADR 0004)                                                                                        |
| 6   | Onboarding checklist                                      | 02                 | Done                                                                                                                                                |
| 7   | Factory and policy versions pinned                        | 02                 | Partial: owner-attested (ADR 0004)                                                                                                                  |
| 8   | Signing tested locally and on GitHub                      | 02, 08             | Controlled only (#267)                                                                                                                              |
| 9   | One active delivery per repository                        | 03                 | Done                                                                                                                                                |
| 10  | Independent repositories run separately                   | 03                 | Done                                                                                                                                                |
| 11  | Changes on a feature branch                               | 05                 | Done (`aios/feature-<id>`)                                                                                                                          |
| 12  | Isolated coding worker                                    | 04, 18–20, 24, 25  | Done (worker qualification)                                                                                                                         |
| 13  | Isolation qualified on both hosts                         | 04, 15, 16, 24, 25 | Done, changed: Mac only (ADR 0007)                                                                                                                  |
| 14  | Model-only subscription auth and allowance gate           | 04, 21, 22         | Done, changed: metered key, relay only, spend budget (ADRs 0006 and 0008)                                                                           |
| 15  | Dependency scripts and validation inside isolation        | 04, 19, 22         | Done: offline npm installs from a host-verified cache, install scripts included, run isolated natively (30 October and [11 November](ticket04-macos-install-scripts-acceptance-receipt.md) receipts); the CLI installs when the contract declares `prepared-npm` (#278) |
| 16  | Synthetic disposable database-backed E2E                  | 06                 | Done: a fresh PostgreSQL per E2E check, natively ([11 November receipt](ticket06-macos-database-acceptance-receipt.md)) |
| 17  | Unchanged-main baseline failures identified               | 06                 | Done                                                                                                                                                |
| 18  | Format, lint, types, coverage, build run where declared   | 06                 | Done for local validation                                                                                                                           |
| 19  | Browser and database tests when needed                    | 06                 | Done: a fresh PostgreSQL and the admitted Playwright image per E2E check, natively ([database](ticket06-macos-database-acceptance-receipt.md) and [browser](ticket06-macos-browser-acceptance-receipt.md) receipts) |
| 20  | Results tied to revisions and trusted publishers          | 06, 09             | Done: local results, and on the [first real delivery](first-real-delivery-receipt.md) its `pr-ci` from `github-actions` on the exact head |
| 21  | Missing, skipped or neutral checks are incomplete         | 06, 09             | Partial: local; a delivery's not-yet-started `pr-ci` read `incomplete` natively (first real delivery, run 2); skipped and neutral in tests only |
| 22  | Failures and reruns preserved                             | 06, 09             | Partial: local; PR checks natively by the PR check acceptance, not yet on a delivery                                                               |
| 23  | Tests and thresholds protected                            | 06                 | Done: owner-held validation contract                                                                                                                |
| 24  | App authors PRs, owner signs commits                      | 08, 17             | Partial: done on the [first real delivery](first-real-delivery-receipt.md) (App-authored PR 11, owner-signed Verified commit); the pilot (#275) remains |
| 25  | Straightforward review findings repaired                  | 10                 | Partial: the owner's 👍 finding is assessed and resolved natively ([receipt](ticket10-macos-review-acceptance-receipt.md)); no native review repair yet |
| 26  | Disputed review requests escalated                        | 10                 | Controlled only (#269)                                                                                                                              |
| 27  | Current-head approval authorizes merge                    | 10, 11, 17         | Partial: natively an ungated head merged on its exact-head authorization ([12 November receipt](ticket11-macos-merge-delivery-receipt.md)), and the owner's exact-head approval authorizes a gated head; no gated delivery merged yet |
| 28  | New commits invalidate approval                           | 10, 11             | Controlled only; changed as story 27                                                                                                                |
| 29  | Agent never submits the owner's approval                  | 08, 10             | Done: the adapter has no way to submit a review; the owner approved in GitHub, and the [first real delivery](first-real-delivery-receipt.md) submitted none |
| 30  | Bounded implementation and repair allowances              | 05, 07             | Done: coding and repair natively ([repair receipt](ticket07-macos-repair-acceptance-receipt.md)); owner-set repair allowance at `start` (#287) |
| 31  | Explicit allowance extensions                             | 05, 07             | Done (`extend-coding`, `extend-budget`, `extend-repair`)                                                                                            |
| 32  | CI waits bounded, approval waits unhurried                | 09, 10             | Controlled only                                                                                                                                     |
| 33  | Status and evidence during waits                          | 01                 | Done                                                                                                                                                |
| 34  | Pause preserves resumable work                            | 03, 23             | Done (session acceptance)                                                                                                                           |
| 35  | Cancel stops without deleting work                        | 03, 23             | Done                                                                                                                                                |
| 36  | Restart reconciles uncertain effects                      | 03, 23             | Partial: done for coding sessions; later stages are controlled only                                                                                 |
| 37  | Budget and session identity survive restart               | 03, 05, 23         | Done                                                                                                                                                |
| 38  | Approval, checks and head revalidated at merge            | 11                 | Done: `merge-feature` re-checked checks, review and production, then merged only the exact head onto the expected main ([12 November receipt](ticket11-macos-merge-delivery-receipt.md)) |
| 39  | Main checks verified after merge                          | 12, 17             | Partial: natively on a real delivery, through the default branch's own push run ([12 November receipt](ticket12-macos-main-delivery-receipt.md)); the pilot (#275) remains |
| 40  | Post-merge fixes use a new signed PR                      | 12                 | Controlled only                                                                                                                                     |
| 41  | Clean main fast-forwarded                                 | 13                 | Done: `sync-main` fast-forwarded a real delivery's clean checkout to exactly the verified main ([13 November receipt](ticket13-macos-sync-delivery-receipt.md)) |
| 42  | Dirty or divergent main blocks                            | 13                 | Controlled only                                                                                                                                     |
| 43  | All eligible merged branches considered                   | 14                 | Done: every local and remote branch was inventoried, and four earlier deliveries' merged branches were deleted with this one's ([13 November receipt](ticket14-macos-cleanup-delivery-receipt.md)) |
| 44  | Squash and rebase linkage                                 | 14                 | Controlled only: the native adapter reads merged PR history, tested against a GitHub stand-in; no squash-merged branch on a real delivery yet |
| 45  | Newer and local-only work preserved                       | 14                 | Partial: 13 unmerged branches were kept natively ([13 November receipt](ticket14-macos-cleanup-delivery-receipt.md)); a newer tip only in tests |
| 46  | Protected and worktree branches retained                  | 14                 | Controlled only: natively implemented, tested against a GitHub stand-in |
| 47  | Deletion conditioned on the evaluated tip                 | 14                 | Done: each of 5 native deletions was conditioned on its evaluated tip, locally with the old value and remotely with a lease ([13 November receipt](ticket14-macos-cleanup-delivery-receipt.md)) |
| 48  | Partial cleanup recorded and resumable                    | 14                 | Controlled only                                                                                                                                     |
| 49  | Completion or blocker report                              | 01, 14, 17         | Done: blocker reports, and the completed delivery's report of revision, deleted and retained branches and next action ([13 November receipt](ticket14-macos-cleanup-delivery-receipt.md)) |
| 50  | Logs and artifacts exclude credentials                    | 01, 19–21          | Done: the key never leaves the Keychain and gateway                                                                                                 |
| 51  | Dedicated VM boundary per delivery                        | 18–20, 23          | Partial: one dedicated VM, with a container per session; decision in #264                                                                           |
| 52  | Offline feasibility kept apart from production            | 19, 24, 25         | Done: reports say `qualified: false`, `productionEnabled: false`                                                                                    |
| 53  | Network denial tested against reachable services          | 20                 | Partial: denial is probed natively, and the relay is the positive control; reachable synthetic denial targets were only on the removed fixed worker |
| 54  | Online model and dependency access constrained separately | 21, 22             | Partial: model access is relay only; dependency access is #265                                                                                      |
| 55  | Exhaustion preserves work without paid fallback           | 21, 22             | Done, changed: a budget interruption preserves the work (ADR 0008)                                                                                  |
| 56  | Runtime and policy changes invalidate qualification       | 18, 24, 25         | Done: shown again by the 10 and 13 November re-pins                                                                                                         |

In total:

| Status          | Count | Stories                                                                   |
| --------------- | ----- | ------------------------------------------------------------------------- |
| Done            | 30    | 1, 2, 4, 6, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 23, 29, 30, 31, 33, 34, 35, 37, 38, 41, 43, 47, 49, 50, 52, 56 |
| Done, changed   | 4     | 3, 13, 14, 55                                                             |
| Partial         | 13    | 5, 7, 21, 22, 24, 25, 27, 36, 39, 45, 51, 53, 54                          |
| Controlled only | 9     | 8, 26, 28, 32, 40, 42, 44, 46, 48                                         |
| Not done        | 0     |                                                                           |

Tickets 08 to 14 now have native adapters, each run on a real delivery, and
16's complete qualification passed natively. No story is complete end to end
until 17, the pilot, has run.
