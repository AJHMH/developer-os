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
- **The CLI's own statement:** `publish-feature`, the PR-check, review, merge,
  main-observer, sync and cleanup commands each say that no native adapter is
  installed, and production delivery stays disabled (`src/cli.ts`).

"Native" below means observed on the Mac through the real CLI or runtime.
"Controlled" means implemented and tested only against test stand-ins.

## Tickets

There are 25 tickets, 01 to 25.

| Ticket                           | Status                                                         | Where it stands                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Durable request and status    | Completed                                                      | Native: `start` and `status`.                                                                                                                           |
| 02 Onboarding readiness          | Completed                                                      | Onboarding facts the CLI can't observe are owner-attested (ADR 0004).                                                                                   |
| 03 Ownership, pause and recovery | Completed                                                      | Native pause, cancel and recover reach the exact coding session.                                                                                        |
| 04 Isolated worker gate          | Open, [#264](https://github.com/AJHMH/developer-os/issues/264) | Its worker criteria are observed natively for Claude Code. Production admission, the dependency phase and the per-delivery boundary remain.             |
| 05 Bounded feature candidate     | Completed                                                      | The last criterion, the pinned CLI adapter with structured events and explicit resume, is met by Claude Code: the session and CLI delivery acceptances. |
| 06 Isolated validation           | Open, [#265](https://github.com/AJHMH/developer-os/issues/265) | Native baseline and candidate validation. E2E on disposable infrastructure and the dependency phases remain.                                            |
| 07 Validation repair             | Open, [#266](https://github.com/AJHMH/developer-os/issues/266) | Controlled. A native repair acceptance remains.                                                                                                         |
| 08 Signed App publication        | Open, [#267](https://github.com/AJHMH/developer-os/issues/267) | Controlled; no native publisher.                                                                                                                        |
| 09 Trusted PR checks             | Open, [#268](https://github.com/AJHMH/developer-os/issues/268) | Controlled; no native monitor.                                                                                                                          |
| 10 Review and owner approval     | Open, [#269](https://github.com/AJHMH/developer-os/issues/269) | Controlled. Approval follows the change gate (ADR 0005).                                                                                                |
| 11 Conditional merge             | Open, [#270](https://github.com/AJHMH/developer-os/issues/270) | Controlled; no native merge adapter.                                                                                                                    |
| 12 Merged main verification      | Open, [#271](https://github.com/AJHMH/developer-os/issues/271) | Controlled; no native main observer.                                                                                                                    |
| 13 Safe main sync                | Open, [#272](https://github.com/AJHMH/developer-os/issues/272) | Controlled; no native Git adapter.                                                                                                                      |
| 14 Cleanup and completion        | Open, [#273](https://github.com/AJHMH/developer-os/issues/273) | Controlled; no native cleanup adapter.                                                                                                                  |
| 15 Windows qualification         | Superseded                                                     | ADR 0007: the Mac is the only owner host.                                                                                                               |
| 16 macOS qualification           | Open, [#274](https://github.com/AJHMH/developer-os/issues/274) | Never run for the complete controller.                                                                                                                  |
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
| 15  | Dependency scripts and validation inside isolation        | 04, 19, 22         | Partial: validation is isolated; the dependency phase is #264 and #265                                                                              |
| 16  | Synthetic disposable database-backed E2E                  | 06                 | Not done (#265)                                                                                                                                     |
| 17  | Unchanged-main baseline failures identified               | 06                 | Done                                                                                                                                                |
| 18  | Format, lint, types, coverage, build run where declared   | 06                 | Done for local validation                                                                                                                           |
| 19  | Browser and database tests when needed                    | 06                 | Not done (#265)                                                                                                                                     |
| 20  | Results tied to revisions and trusted publishers          | 06, 09             | Partial: local results are; PR checks are controlled only (#268)                                                                                    |
| 21  | Missing, skipped or neutral checks are incomplete         | 06, 09             | Partial: local; PR checks controlled only                                                                                                           |
| 22  | Failures and reruns preserved                             | 06, 09             | Partial: local; PR checks controlled only                                                                                                           |
| 23  | Tests and thresholds protected                            | 06                 | Done: owner-held validation contract                                                                                                                |
| 24  | App authors PRs, owner signs commits                      | 08, 17             | Controlled only (#267)                                                                                                                              |
| 25  | Straightforward review findings repaired                  | 10                 | Controlled only (#269)                                                                                                                              |
| 26  | Disputed review requests escalated                        | 10                 | Controlled only (#269)                                                                                                                              |
| 27  | Current-head approval authorizes merge                    | 10, 11, 17         | Controlled only; changed: needed only for gated heads (ADR 0005)                                                                                    |
| 28  | New commits invalidate approval                           | 10, 11             | Controlled only; changed as story 27                                                                                                                |
| 29  | Agent never submits the owner's approval                  | 08, 10             | Controlled only, by design                                                                                                                          |
| 30  | Bounded implementation and repair allowances              | 05, 07             | Partial: coding is native; repair is #266                                                                                                           |
| 31  | Explicit allowance extensions                             | 05, 07             | Done (`extend-coding`, `extend-budget`, `extend-repair`)                                                                                            |
| 32  | CI waits bounded, approval waits unhurried                | 09, 10             | Controlled only                                                                                                                                     |
| 33  | Status and evidence during waits                          | 01                 | Done                                                                                                                                                |
| 34  | Pause preserves resumable work                            | 03, 23             | Done (session acceptance)                                                                                                                           |
| 35  | Cancel stops without deleting work                        | 03, 23             | Done                                                                                                                                                |
| 36  | Restart reconciles uncertain effects                      | 03, 23             | Partial: done for coding sessions; later stages are controlled only                                                                                 |
| 37  | Budget and session identity survive restart               | 03, 05, 23         | Done                                                                                                                                                |
| 38  | Approval, checks and head revalidated at merge            | 11                 | Controlled only (#270)                                                                                                                              |
| 39  | Main checks verified after merge                          | 12, 17             | Controlled only (#271)                                                                                                                              |
| 40  | Post-merge fixes use a new signed PR                      | 12                 | Controlled only                                                                                                                                     |
| 41  | Clean main fast-forwarded                                 | 13                 | Controlled only (#272)                                                                                                                              |
| 42  | Dirty or divergent main blocks                            | 13                 | Controlled only                                                                                                                                     |
| 43  | All eligible merged branches considered                   | 14                 | Controlled only (#273)                                                                                                                              |
| 44  | Squash and rebase linkage                                 | 14                 | Controlled only                                                                                                                                     |
| 45  | Newer and local-only work preserved                       | 14                 | Controlled only                                                                                                                                     |
| 46  | Protected and worktree branches retained                  | 14                 | Controlled only                                                                                                                                     |
| 47  | Deletion conditioned on the evaluated tip                 | 14                 | Controlled only                                                                                                                                     |
| 48  | Partial cleanup recorded and resumable                    | 14                 | Controlled only                                                                                                                                     |
| 49  | Completion or blocker report                              | 01, 14, 17         | Partial: blocker reports are native; the completion report needs #273                                                                               |
| 50  | Logs and artifacts exclude credentials                    | 01, 19–21          | Done: the key never leaves the Keychain and gateway                                                                                                 |
| 51  | Dedicated VM boundary per delivery                        | 18–20, 23          | Partial: one dedicated VM, with a container per session; decision in #264                                                                           |
| 52  | Offline feasibility kept apart from production            | 19, 24, 25         | Done: reports say `qualified: false`, `productionEnabled: false`                                                                                    |
| 53  | Network denial tested against reachable services          | 20                 | Partial: denial is probed natively, and the relay is the positive control; reachable synthetic denial targets were only on the removed fixed worker |
| 54  | Online model and dependency access constrained separately | 21, 22             | Partial: model access is relay only; dependency access is #265                                                                                      |
| 55  | Exhaustion preserves work without paid fallback           | 21, 22             | Done, changed: a budget interruption preserves the work (ADR 0008)                                                                                  |
| 56  | Runtime and policy changes invalidate qualification       | 18, 24, 25         | Done: shown again by the 10 November re-pin                                                                                                         |

In total:

| Status          | Count | Stories                                                                   |
| --------------- | ----- | ------------------------------------------------------------------------- |
| Done            | 19    | 1, 2, 4, 6, 9, 10, 11, 12, 17, 18, 23, 31, 33, 34, 35, 37, 50, 52, 56     |
| Done, changed   | 4     | 3, 13, 14, 55                                                             |
| Partial         | 12    | 5, 7, 15, 20, 21, 22, 30, 36, 49, 51, 53, 54                              |
| Controlled only | 19    | 8, 24, 25, 26, 27, 28, 29, 32, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48 |
| Not done        | 2     | 16, 19                                                                    |

No story is complete end to end until tickets 08 to 14 have native adapters and
16 and 17 have run.
