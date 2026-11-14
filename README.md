# Developer OS

A local TypeScript controller for owner-approved feature delivery. It implements durable intake and controls, Claude Code coding sessions and isolated validation in per-session containers on one dedicated Podman VM on Apple-silicon macOS, and delivery orchestration from planning through signed publication, PR checks, review, merge, main synchronization, eligible branch cleanup and completion. Every stage's native adapter has run on real deliveries to a disposable repository, and the complete controller qualification passed on the Mac on 13 November 2026. **Production feature delivery remains disabled.** The observed pilot delivery is unfinished.

The owner's Mac is the only owner host ([ADR 0007](docs/adr/0007-macos-only-owner-host.md)): the CLI refuses to start on any other operating system.

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

Host fixtures use `python3`; set `AIOS_TEST_PYTHON` to use another interpreter. Off macOS (for example on Linux CI), `npm test` sets `AIOS_TEST_HOST_PLATFORM=darwin` so the suite's CLI runs stand in for the Mac. Tests need permission for temporary Git repositories and synthetic localhost services. The tests make no metered model requests and need no Anthropic key. A passing local run is not a native qualification or hosted certification.

## Submit and inspect a request

Set `DELIVERY_ID` to the id that `start` prints before inspecting one delivery.

```sh
node dist/cli.js start --repo "/absolute/existing/repository" --request "Add a visible contact hint." --state-dir "/absolute/controller-state"
node dist/cli.js status --id "${DELIVERY_ID:?}" --state-dir "/absolute/controller-state"
node dist/cli.js status --state-dir "/absolute/controller-state"
```

Use quoted absolute paths. State defaults to `.developer-os` under the user's home directory; keep state outside target repositories. A successful command emits JSON and exits zero. Accepted intake remains blocked by `DELIVERY_NOT_ENABLED`; exit zero does not mean delivery completed. Invalid commands and inaccessible state emit a fixed JSON error on stderr.

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

One configured authority directory coordinates ownership per canonical repository. Queued requests wait for safe release. Pause/cancel/recovery fence sessions and require matching descendant-shutdown evidence; unknown shutdown retains ownership. Cancellation preserves work and does not close PRs, delete branches or roll back effects. For native sessions, supply `--podman-machine` with the owner's `--coding-admission` and `--validation-admission` to pause, cancel and recover. Separate state stores do not share ownership.

## Model access and the worker VM

`prepare-auth` writes the non-secret host registration, and `store-anthropic-key` keeps the owner's Anthropic API key in the macOS Keychain for metered coding turns (ADRs 0006 and 0008). Each delivery's spend budget is the only authority for its model requests; there is no subscription usage reader and no paid fallback beyond the budget.

Coding and validation run on the dedicated `aios-macos-noshare` VM, each admitted only by the owner's record naming its fresh pins. Read the runbooks before an owner run:

- [macOS worker VM](docs/macos-worker-qualification.md)
- [Offline general-worker qualification](docs/worker-qualification.md)

## Controlled delivery stages

The public `DeliveryController` accepts explicit trusted host adapters. They are not loaded from repository configuration or worker output. The CLI exposes stage commands but refuses production effects without the required qualified integrations.

| Stage       | Commands                                                           | Contract                                                |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| Candidate   | `plan-feature`, `clarify-feature`, `code-feature`, `extend-coding` | [Feature candidates](docs/feature-candidate.md)         |
| Validation  | `validate-baseline`, `validate-candidate`                          | [Isolated validation](docs/isolated-validation.md)      |
| Repair      | `repair-feature`, `extend-repair`                                  | [Bounded repair](docs/bounded-repair.md)                |
| Publication | `publish-feature`, `reconcile-publication`                         | [Signed publication](docs/signed-publication.md)        |
| PR checks   | `monitor-pr-checks`, `repair-pr-checks`, `rerun-pr-check`          | [Trusted checks](docs/trusted-pr-checks.md)             |
| Review      | `monitor-review`, `repair-review`, `resolve-review-thread`         | [Review and change gate](docs/review-owner-approval.md) |
| Merge       | `merge-feature`, `reconcile-merge`, `refresh-merge-base`           | [Conditional merge](docs/conditional-merge.md)          |
| Main checks | `monitor-main-checks`                                              | [Main verification](docs/main-verification.md)          |
| Main sync   | `sync-main`, `reconcile-main-sync`                                 | [Main synchronization](docs/main-synchronization.md)    |
| Cleanup     | `cleanup-branches`, `reconcile-cleanup`                            | [Branch cleanup and completion](docs/branch-cleanup.md) |

Commands address an explicit `--id`; extensions and individual check/thread actions also require their documented arguments. With the owner's records, each command installs its native adapter: publication signs through the owner's key and opens the PR as the Software Factory App, and every later stage acts through the owner's `gh` login. Each contract document records its native acceptance. Merge approval is required only for a change the [change gate](docs/adr/0005-change-gate-replaces-universal-merge-approval.md) classifies as gated. Tests exercise real temporary Git and persisted ledger state with external observations supplied by test adapters; they do not establish native delivery. Main verification alone does not synchronize branches or perform cleanup.

## Factory and project documents

Factory consumer workflows and automatic approval refresh are implemented. [Hosted evidence](.scratch/factory-approval-refresh/hosted-validation-20261014.md) records original-job reruns and stale-approval rejection. The immutable revision in `factory.lock.yaml` and workflow calls is authoritative for local configuration. No successful Factory certification receipt was found; CI adoption does not certify autonomous delivery.

- [Architecture](docs/architecture.md), [contributor onboarding](docs/contributor-onboarding.md) and the [operations playbook](docs/playbook.md)
- [Factory onboarding](docs/factory-onboarding.md) and [approval refresh](docs/factory-approval-refresh.md)
- [Domain vocabulary](CONTEXT.md) and [target specification](.scratch/aios-feature-delivery/spec.md)
- [Implementation status and ADR audit](docs/implementation-status.md)

Root AIOS research and model explanation files are historical design material, not inventories of implemented features.
