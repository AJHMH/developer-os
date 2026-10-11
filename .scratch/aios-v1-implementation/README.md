# AIOS v1 implementation tickets

Status: published
Approved: 7 October 2026

Canonical source: [Developer AIOS v1 specification](../aios-feature-delivery/spec.md). These are implementation slices; the resolved wayfinder issues remain unchanged.

Work any ready ticket whose blockers are complete. Tickets **01–03, 18–20 and 23** are completed. The frontier is **21: Qualify model-only subscription authentication mediation**; ticket 22 remains blocked pending its positive qualification. The owner approved slices 18–25 to support open parent ticket **04**. Demonstrated Windows offline feasibility does not close that parent; its completion requires positive applicable qualification from the new slices. Ticket 05 remains blocked by 04. Windows/macOS qualification is independent; both gate the observed pilot. Ticket readiness describes implementable work, not verified host/repository readiness or authorization to bypass owner approval.

The revised canonical specification supersedes historical Docker-specific candidate and proxy/spending-cap wording in ticket 04. Preserve that parent and its evidence; no acceptance criterion is waived. A negative authentication investigation in 21 leaves 22 and production dispatch blocked. Tickets 24–25 qualify the worker boundary; existing 15–16 later qualify the complete delivery workflow. No new child depends on 04, avoiding a parent/child dependency cycle. See the [approved breakdown](podman-ticket-proposal.md).

10 October ticket 19 completion: the native Windows driver is wired, live offline admission verified, and an actual controller-driven synthetic round trip completed after independent descendant shutdown. [Native acceptance evidence](ticket19-native-roundtrip.json) and the explicit acceptance runner retain the exact bindings/session, unsafe-input and uncertainty/recovery results. Production readiness remains false. The [9 October refused-admission observation](ticket19-live-observation.json) remains as historical evidence. Tickets 20/23 are now unblocked; their broader adversarial qualification is still outstanding.

| Ticket | Blocked by | User stories |
|---|---|---|
| [01: Submit a feature request and inspect durable delivery status](issues/01-durable-request-status.md) | None | 1, 2, 33, 49, 50 |
| [02: Report repository onboarding readiness without changing setup](issues/02-onboarding-readiness.md) | 1 | 5, 6, 7, 8 |
| [03: Queue, pause, cancel and recover repository-owned deliveries](issues/03-ownership-pause-recovery.md) | 1 | 9, 10, 34, 35, 36, 37 |
| [04: Launch an isolated worker with a fail-closed qualification gate](issues/04-isolated-worker-gate.md) | 2, 3 | 12, 13, 14, 15 |
| [05: Implement a bounded feature and safely admit the worker result](issues/05-bounded-feature-candidate.md) | 4 | 3, 4, 11, 30, 31, 37 |
| [06: Validate baseline and candidate behavior inside isolation](issues/06-isolated-validation.md) | 5 | 16, 17, 18, 19, 20, 21, 22, 23 |
| [07: Repair validation findings within persisted allowances](issues/07-bounded-validation-repair.md) | 6 | 30, 31 |
| [08: Publish signed code and create an App-authored PR](issues/08-signed-app-publication.md) | 7 | 8, 24, 29 |
| [09: Monitor trusted PR checks for the current revision](issues/09-trusted-pr-checks.md) | 8 | 20, 21, 22, 32 |
| [10: Address review findings and wait for owner approval](issues/10-review-owner-approval.md) | 9 | 25, 26, 27, 28, 29, 32 |
| [11: Merge only the validated and owner-approved head](issues/11-conditional-owner-merge.md) | 10 | 27, 28, 38 |
| [12: Verify merged main and block unsafe recovery](issues/12-merged-main-verification.md) | 11 | 39, 40 |
| [13: Synchronize clean local main without losing work](issues/13-safe-main-sync.md) | 12 | 41, 42 |
| [14: Clean eligible merged branches and report delivery completion](issues/14-eligible-cleanup-completion.md) | 13 | 43, 44, 45, 46, 47, 48, 49, 50 |
| [15: Qualify the complete controller boundary on Windows](issues/15-windows-qualification.md) | 14 | 13 |
| [16: Qualify the complete controller boundary on macOS](issues/16-macos-qualification.md) | 14 | 13 |
| [17: Demonstrate an observed profile-page pilot delivery](issues/17-observed-profile-pilot.md) | 15, 16 | 1, 24, 27, 39, 49 |
| [18: Admit a pinned dedicated Windows VM through the controller](issues/18-pinned-windows-vm.md) | 2, 3 (completed) | 12, 51, 52, 56 |
| [19: Run and safely collect an offline delivery canary](issues/19-offline-workspace-roundtrip.md) | 18 | 12, 15, 50, 51, 52 |
| [20: Prove forbidden access with positive controls](issues/20-positive-control-isolation.md) | 19 | 12, 50, 51, 53, 56 |
| [21: Qualify model-only subscription authentication mediation](issues/21-subscription-auth-mediation.md) | 18 | 14, 50, 54, 55 |
| [22: Dispatch online inference under independently enforced access policy](issues/22-online-access-usage-gate.md) | 20, 21 (positive qualification) | 14, 15, 31, 54, 55 |
| [23: Fence and reconcile VM descendants across controller interruption](issues/23-vm-fencing-recovery.md) | 19 | 9, 34, 35, 36, 37, 51 |
| [24: Qualify the Windows production worker path](issues/24-windows-worker-qualification.md) | 22, 23 | 12, 13, 14, 15, 52, 56 |
| [25: Independently qualify the macOS worker path](issues/25-macos-worker-qualification.md) | 24 | 12, 13, 14, 15, 52, 56 |

10 October ticket 04 progress: [20 isolation evidence](ticket20-native-isolation.json) and [23 fencing/recovery evidence](ticket23-native-fencing.json) passed for the fixed native Windows synthetic worker. Ticket 21 remains open after [credential-free protocol/relay canaries](ticket21-protocol-observation.json) and separate registration preparation. The owner confirmed no Mac is available; independent macOS qualification is blocked. Parent 04 remains open and production disabled.

10 October independent Mac progress: the owner supplied an Apple-silicon Mac.
Parent 04 now has a native AppleHV ARM64 synthetic offline path, independently
observed transfer/result collection, positive-control denial/escape canaries and
eight-process pause/fencing/crash recovery. Credential-free pinned Codex host
protocol and relay also passed. See [macOS worker qualification](../../docs/macos-worker-qualification.md).
Authentication/online/production blockers are unchanged; parent 04 and tickets
25/16 remain incomplete. The prior no-Mac statement above is historical.
