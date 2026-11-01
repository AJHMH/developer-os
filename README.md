# Developer OS

A local TypeScript controller for owner-approved feature delivery. It implements durable intake and controls, independently demonstrated fixed Podman workers on Windows and Apple-silicon macOS, and controlled delivery orchestration through synchronization, eligible branch cleanup and completion. **Production feature delivery remains disabled.** Native delivery integrations (including synchronization and cleanup) and full-platform/pilot qualification are unfinished.

See [implementation status](docs/implementation-status.md) for completed scope, evidence and remaining gates; [implementation tickets](.scratch/aios-v1-implementation/README.md) track acceptance separately from implemented code.

## Requirements and checks

Use Node **24.10 or later in the Node 24 release line** and npm. `.nvmrc` selects Node 24.15.0. The controller uses Node's built-in SQLite API, which emits an experimental warning on that runtime.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run format:check
npm test
npm run build
npm run test:cli
```

On this Mac, use `AIOS_TEST_PYTHON=/usr/bin/python3 npm test` for host fixtures. Tests need permission for temporary Git repositories and synthetic localhost services. The tests do not authorize live subscription inference. The latest retained ticket 12 local run records 497 tests: 495 passed and two platform skips; it is historical validation, not a fresh run or current hosted certification.

## Submit and inspect a request

Set `DELIVERY_ID` to the id that `start` prints before inspecting one delivery.

```sh
node dist/cli.js start --repo "/absolute/existing/repository" --request "Add a visible contact hint." --state-dir "/absolute/controller-state"
node dist/cli.js status --id "${DELIVERY_ID:?}" --state-dir "/absolute/controller-state"
node dist/cli.js status --state-dir "/absolute/controller-state"
```

Use quoted absolute native paths on Windows. State defaults to `.developer-os` under the user's home directory; keep state outside target repositories. A successful command emits JSON and exits zero. Accepted intake remains blocked by `DELIVERY_NOT_ENABLED`; exit zero does not mean delivery completed. Invalid commands and inaccessible state emit a fixed JSON error on stderr.

Requests, optional `--issue` references and request artifacts survive restart in SQLite WAL with full synchronization. Back up ledger and artifacts together. Redaction handles common credential formats but cannot detect arbitrary secrets; keep secrets out of requests, references and paths.

## Owner policy and controls

`start --owner-policy "/absolute/external/owner-policy.json"` selects an explicit owner-controlled onboarding policy. It is never discovered from candidate files. Onboarding records verified, unknown and conflicting facts; an onboarding snapshot does not replace fresh dispatch authorization. The [canonical specification](.scratch/aios-feature-delivery/spec.md) defines authority and approval requirements.

Each control names a delivery by `DELIVERY_ID`:

```sh
node dist/cli.js pause --id "${DELIVERY_ID:?}" --state-dir "/absolute/controller-state"
node dist/cli.js resume --id "${DELIVERY_ID:?}" --state-dir "/absolute/controller-state"
node dist/cli.js cancel --id "${DELIVERY_ID:?}" --state-dir "/absolute/controller-state"
node dist/cli.js recover --id "${DELIVERY_ID:?}" --state-dir "/absolute/controller-state"
node dist/cli.js release --id "${DELIVERY_ID:?}" --state-dir "/absolute/controller-state"
```

One configured authority directory coordinates ownership per canonical repository. Queued requests wait for safe release. Pause/cancel/recovery fence sessions and require matching descendant-shutdown evidence; unknown shutdown retains ownership. Cancellation preserves work and does not close PRs, delete branches or roll back effects. For native sessions, supply the same `--podman-machine` and external `--worker-policy` to pause, cancel and recover. Separate state stores do not share ownership.

## Subscription and fixed worker qualification

Host-only authentication uses macOS Keychain or Windows protected storage. Workers receive scoped revocable capabilities rather than reusable owner credentials. Low (20% or less remaining), unknown or stale usage requires a fresh run-bound allowance; exhaustion cannot be overridden. Other account activity can consume usage between observations, so this is not a hard financial cap. There is no paid-provider fallback.

`check-usage`, `approve-usage` and `poll-usage` address an explicit delivery. An owner-selected absolute `--codex-executable` supplies app-server account/usage observations. `prepare-auth`, `authorize-auth` and `auth-status` manage separate external host authentication; sign-in is not approval for inference.

`pin-offline`, `qualify`, `offline-canary`, `online-canary`, `qualify-windows-controls`, `qualify-macos-controls`, `synthetic-task` and `qualification-report` implement fixed synthetic admission/qualification paths. Enrollment requires an owner-selected `aios-` machine and external pins. Changed host/source/policy bindings require fresh qualification. Read the platform runbook before using operator fixtures:

- [Windows worker qualification](docs/windows-worker-qualification.md)
- [macOS worker qualification](docs/macos-worker-qualification.md)
- [Offline general-worker qualification](docs/worker-qualification.md)

Both platforms have independent fixed-worker passing receipts. These are version-bound results; historical approvals authorize no new inference. `qualification-report` never enables production.

## Controlled delivery stages

The public `DeliveryController` accepts explicit trusted host adapters. They are not loaded from repository configuration or worker output. The CLI exposes stage commands but refuses production effects without the required qualified integrations.

| Stage       | Commands                                                           | Contract                                                |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| Candidate   | `plan-feature`, `clarify-feature`, `code-feature`, `extend-coding` | [Feature candidates](docs/feature-candidate.md)         |
| Validation  | `validate-baseline`, `validate-candidate`                          | [Isolated validation](docs/isolated-validation.md)      |
| Repair      | `repair-feature`, `extend-repair`                                  | [Bounded repair](docs/bounded-repair.md)                |
| Publication | `publish-feature`, `reconcile-publication`                         | [Signed publication](docs/signed-publication.md)        |
| PR checks   | `monitor-pr-checks`, `repair-pr-checks`, `rerun-pr-check`          | [Trusted checks](docs/trusted-pr-checks.md)             |
| Review      | `monitor-review`, `repair-review`, `resolve-review-thread`         | [Owner approval](docs/review-owner-approval.md)         |
| Merge       | `merge-feature`, `reconcile-merge`, `refresh-merge-base`           | [Conditional merge](docs/conditional-merge.md)          |
| Main checks | `monitor-main-checks`                                              | [Main verification](docs/main-verification.md)          |
| Main sync   | `sync-main`, `reconcile-main-sync`                                 | [Main synchronization](docs/main-synchronization.md)    |
| Cleanup     | `cleanup-branches`, `reconcile-cleanup`                            | [Branch cleanup and completion](docs/branch-cleanup.md) |

Commands address an explicit `--id`; extensions and individual check/thread actions also require their documented arguments. Controlled tests exercise real temporary Git and persisted ledger state with external observations supplied by test adapters. They do not establish native publication or complete delivery. Main verification alone does not synchronize branches or perform cleanup. Controlled `sync-main` and `reconcile-main-sync` require fresh main evidence and a trusted conditional Git adapter; no native synchronization adapter is installed. See [safe main synchronization](docs/main-synchronization.md).

## Factory and project documents

Factory consumer workflows and automatic approval refresh are implemented. [Hosted evidence](.scratch/factory-approval-refresh/hosted-validation-20261014.md) records original-job reruns and stale-approval rejection. The immutable revision in `factory.lock.yaml` and workflow calls is authoritative for local configuration. No successful Factory certification receipt was found; CI adoption does not certify autonomous delivery.

- [Factory onboarding](docs/factory-onboarding.md) and [approval refresh](docs/factory-approval-refresh.md)
- [Domain vocabulary](CONTEXT.md) and [target specification](.scratch/aios-feature-delivery/spec.md)
- [Implementation status and ADR audit](docs/implementation-status.md)

Root AIOS research and model explanation files are historical design material, not inventories of implemented features.
