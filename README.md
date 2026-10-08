# Developer OS

A local TypeScript controller for owner-approved feature delivery. The first implemented slice accepts requests and reports durable status; it does not yet run agents, change Git branches, push code, create PRs or merge.

## Requirements and checks

Use Node **24.10 or later in the Node 24 release line** and npm. This slice uses Node's built-in SQLite API, which emits an experimental-feature warning on this runtime.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run format:check
npm test
```

`npm run build` emits the CLI; `npm run test:cli` runs its behavior tests. Tests use temporary repositories and real local SQLite state. They do not contact GitHub or read signing keys.

## Submit and inspect a feature request

Build first, then provide an **absolute existing repository directory**:

```sh
npm run build
node dist/cli.js start --repo "/absolute/path/to/repository" --request "Add a visible contact hint." --issue "https://github.com/AJHMH/profile-page/issues/42" --state-dir "/absolute/path/to/controller-state"
node dist/cli.js status --id "<returned-delivery-id>" --state-dir "/absolute/path/to/controller-state"
node dist/cli.js status --state-dir "/absolute/path/to/controller-state"
```

On Windows, use quoted absolute Windows paths. If omitted, the state directory is `.developer-os` under your home directory. Keep state outside the target repository and do not place repositories inside the state directory.

Successful commands write one JSON document to stdout and exit zero. Invalid commands or inaccessible state exit nonzero with a fixed JSON error on stderr. `start` returns a unique ID and a **blocked** phase with `DELIVERY_NOT_ENABLED`, plus the next action needed for onboarding and the remaining implementation. Exit zero means the request was accepted, not that feature delivery completed. `status` with no ID lists accepted deliveries.

Requests, optional issue references and separately referenced JSON request artifacts survive controller restarts. The ledger uses SQLite WAL with full synchronization. This is local persistence, not a guarantee against disk loss; retain the ledger and artifacts together when backing up state.

Input redaction removes common labeled credentials, private-key blocks, recognizable provider tokens, bearer tokens and URL user information before persistence. Redaction is defense in depth, not a detector for arbitrary secrets: **do not put secrets in requests, issue references or paths**. Raw input and parser errors are not logged. State is owned by the local user and is not an isolation boundary against that user.

Live isolated workers, signing and remote effects are later tickets. Their commands are not accepted yet. Windows and macOS host qualification remain unperformed; these local intake tests do not prove complete platform support.

See the [approved v1 specification](.scratch/aios-feature-delivery/spec.md) and [implementation ticket index](.scratch/aios-v1-implementation/README.md).

## Repository onboarding report

Every accepted request now stores `onboarding`: timestamped verified/unknown/conflicting facts and a missing-prerequisite checklist. Unknown or conflicting evidence prevents onboarding readiness. Execution remains blocked even when every prerequisite is verified; subsequent tickets implement the delivery gates.

For local inspection, add `--owner-policy "/absolute/path/outside/repository/owner-policy.json"` to `start`. This is an explicit owner input, never discovered from candidate files. The ordinary external file is validated and its SHA-256 and Factory commit are recorded with the report; status preserves that snapshot even if the file later changes. Keep it in owner-controlled storage excluded from worker mounts. Example schema (illustrative pins, not verified setup):

```json
{
  "repository": "AJHMH/profile-page",
  "defaultBranch": "main",
  "factoryCommit": "0000000000000000000000000000000000000000",
  "approver": "aaron-howard",
  "appLogin": "your-factory-app[bot]",
  "publicationLogin": "aaron-howard",
  "requiredChecks": ["owner-declared-check-name"],
  "validation": ["owner-declared-isolated-validation-resource"]
}
```

The CLI reads origin and its cached default-branch hint using bounded read-only Git commands. It neither fetches nor rewrites a mismatch. Cached hints cannot prove live identity. Live App access/authorship, effective protections and check publishers, sole approver, Factory revision, publication identity, signature evidence and validation resources remain unknown in this CLI slice. Configuration alone does not prove signing: the trusted integration must demonstrate valid local and GitHub signatures on the same commit for the pinned publication identity.

`DeliveryController` accepts a host-supplied read-only `inspect` boundary for trusted verification integrations. Controlled test observations exercise complete and conflicting reports; they are not live qualification. This boundary must not consume assertions supplied by workers or candidate configuration. No inspection provider is loaded from a repository, and no repository scripts or credentials are read. Neither tests nor these reports provision Apps, protections or resources. The report is a snapshot, not authorization to skip later current-state revalidation.

## Delivery ownership and controls

Use the same owner-configured state directory for all processes managing repositories on this host. SQLite transactions admit one owner delivery per canonical repository: verified GitHub clones share a canonical identity key, and unverified intake uses the resolved local path. Subsequent requests queue. Paused, blocked and cancelled owners retain ownership until explicit safe release. The ledger migrates prior intake records in submission order while preserving their requests and artifacts.

```sh
node dist/cli.js pause --id "<delivery-id>" --state-dir "/absolute/path/to/controller-state"
node dist/cli.js resume --id "<delivery-id>" --state-dir "/absolute/path/to/controller-state"
node dist/cli.js cancel --id "<delivery-id>" --state-dir "/absolute/path/to/controller-state"
node dist/cli.js recover --id "<delivery-id>" --state-dir "/absolute/path/to/controller-state"
node dist/cli.js release --id "<delivery-id>" --state-dir "/absolute/path/to/controller-state"
```

Controls require an explicit delivery ID. Pause records the prior phase; resume does not clear unresolved worker shutdown. Cancellation prevents new dispatch and cannot be resumed. Neither action closes PRs, deletes branches, removes artifacts or rolls back effects. Safe release requires a stopped delivery and, if a worker session exists, confirmed quiescence. It transfers ownership to the oldest eligible queued request; a paused queued request is skipped until resumed.

Trusted host integrations use `DeliveryController.run` with a qualified worker adapter. Before dispatch, the controller rechecks onboarding against the original policy hash and canonical ownership identity. Changes require safe release and a new request. Worker intents and explicit delivery/repository/runner/operation/sandbox/session identities are durable before adapter dispatch. Resume retains the sandbox and worker IDs with a new operation and fence, preserving previous session records.

Pause, cancel and recovery fence old runners before requesting descendant shutdown. Receipts must match the exact identities and fence. Late results cannot restore a paused/cancelled delivery. Unknown, mismatched, failed or timed-out observations retain ownership with `UNCERTAIN_SESSION`; they cannot justify another dispatch or release. Worker handshake/shutdown observations default to 30 seconds, configurable by the trusted integration up to 60 seconds. Timing out does not prove the worker stopped.

`recover` reconciles the explicit stored session and stops orphaned activity conservatively. It never searches for a global last session or automatically dispatches paused, cancelled or blocked work. Confirmed shutdown of previously running work makes it eligible for fresh admission; a blocked uncertainty outcome still needs explicit resume after shutdown is verified.

Ticket 4 must supply and qualify the actual adapter, pin the single authority directory and demonstrate repository-scoped fencing against delayed starts and descendant processes. Multiple separately configured state stores do not share ownership; qualification must reject that arrangement. The CLI intentionally has no `run` command or production worker adapter yet. Controlled lifecycle tests establish coordinator behavior, not live isolation, GitHub delivery or either platform's qualification.

## Subscription usage approval gate

Worker dispatch now reads fresh ChatGPT subscription usage before each run. At 20% or less remaining in any reported window, or when usage is unknown/stale/unavailable, a stopped owner delivery requires approval. Exhaustion cannot be overridden. An approval is bound to the account/window scope and permits one run; it must be used within 60 seconds. Foreground running controllers poll every 30 seconds. Low/unknown usage without an applicable run approval, or exhausted usage even with approval, requests fenced descendant shutdown and retains work. A failed shutdown remains uncertain. Restart does not reuse a prior run's approval.

The optional owner-selected `--codex-executable` must point to a trusted absolute native Codex executable supporting `app-server`. The reader uses only `initialize`, `account/read` and `account/rateLimits/read`, runs outside the candidate working directory, times out and discards raw protocol errors. It neither reads credential files nor sends inference, purchase, login or rate-limit-reset requests. With no reader, usage is unknown and requires approval. Candidate-controlled executables must not be selected.

```sh
node dist/cli.js check-usage --id "<delivery-id>" --state-dir "/absolute/state" --codex-executable "/absolute/trusted/codex"
node dist/cli.js approve-usage --id "<delivery-id>" --check-id "<current-usage-check-id>" --state-dir "/absolute/state"
node dist/cli.js poll-usage --id "<delivery-id>" --state-dir "/absolute/state" --codex-executable "/absolute/trusted/codex"
```

This is an approval boundary, not a hard financial cap. Other account activity and in-flight requests can consume allowance between observations. Existing usage credits and automatic reload must be controlled separately; the reader does not change billing settings. Approval never enables a paid-provider fallback or purchases credits. Worker isolation qualification remains required independently.

On 7 October 2026, pinned official Codex CLI 0.161.0 successfully returned live ChatGPT subscription usage through its app-server, matching the desktop's weekly observation of 4% used. It was installed only under ignored `.scratch/codex-runtime` for this test; the existing global CLI was preserved. No inference or billing changes were performed. This proves the usage reader on this Windows host, not native worker isolation or macOS compatibility.

## Worker qualification gate (ticket 4 in progress)

The Docker diagnostic path below is retained for historical investigation. The revised candidate is a dedicated Podman-backed VM; ticket 18 adds read-only prerequisite admission, while ticket 4 remains the open production qualification gate.

`node dist/cli.js qualify --id "<delivery-id>" --state-dir "/absolute/path/to/controller-state"` persists a qualification report. It runs bounded native `sbx diagnose --json` from a standard installation location and reports CLI version, virtualization, daemon and authentication prerequisites. It discards raw diagnostic messages, paths and details. Unknown, conflicting, duplicate or unsupported diagnostic fields cannot establish verification. These host facts do not qualify isolation: every isolation probe remains `not-run` until a native enforcement driver is implemented and qualified.

Trusted integrations can provide `SandboxWorkerAdapter` with an external ordinary JSON policy and a host-owned `SandboxRuntime`. The policy pins the host platform, architecture, OS version, hypervisor, sbx and Codex versions, template digest and host identity digest; it declares the single authority directory, a separate workspace directory, revision, ordinary-file SHA-256 manifest, proxy binding, spending limit and permitted HTTPS endpoints. It accepts binding identifiers rather than raw proxy credentials. Candidate files cannot select the provider or change these pins.

The adapter copies admitted bytes into a fresh workspace and rejects Git metadata, credential configuration, hard links, directory links, unsafe paths and recognizable secrets. Fresh challenge-bound evidence is required for every isolation probe. Controlled evidence can exercise the gate but never sets `liveReady`. Effective sandbox configuration is checked again before launch; shutdown requires matching session identity, revoked authority and confirmed stopped descendants. Unknown responses retain ownership for recovery. Retained workspace files are preserved for inspection.

This slice provides the admission and lifecycle protocol plus native host diagnostics, not a native sbx worker driver. Actual effective mounts, proxy enforcement, Windows reparse handling and host-wide atomic fencing still require a trusted runtime implementation and independent Windows/macOS qualification. No real host is qualified and no live worker command is enabled. Docker Sandboxes 0.47.0 is now installed on the Windows implementation host and virtualization passes its diagnostic; daemon startup and Docker authentication remain unresolved. A dedicated model-only proxy with a proven spending cap also needs configuration. The synthetic test version pins are illustrative, not approved runtime versions.

## Podman offline prerequisite admission (ticket 18)

```sh
node dist/cli.js qualify --id "<delivery-id>" --state-dir "/absolute/state" --podman-machine aios-podman-noshare
```

This selects a read-only Windows x64 Hyper-V observation adapter alongside the existing diagnostic adapter. It neither creates nor starts a VM, runs repository code, copies credentials nor sends inference. `status` retains the projected report. Command errors and raw configuration/diagnostic details are discarded. Select only an owner-controlled machine; names must use the `aios-` prefix.

An optional `--worker-policy` selects an external ordinary JSON pin file, outside both the repository and controller state. Its schema is `1`; its `binding` declares platform, architecture, OS version, provider, machine name, host identity SHA-256, engine version, VM-image SHA-256, template OCI digest, worker version and policy version using the keys `platform`, `arch`, `osVersion`, `provider`, `machine`, `hostId`, `engineVersion`, `vmImageSha256`, `template`, `workerVersion` and `policyVersion`. A declaration alone cannot establish an observed pin or enforcement.

Trusted controlled runtime observations exercise the existing controller seam. Matching pins plus observed dedicated VM, hypervisor, empty mounts/capabilities, excluded management authority, rootless mode, offline networking, read-only filesystem, uid/gid 65534 and no-new-privileges can set `offlineAdmission.allowed`. This is only permission for an offline probe; `ready` and `liveReady` remain false and production dispatch always refuses. Missing or changed evidence revokes admission on requalification.

The native collector currently verifies host/platform/provider and the responding engine version. Stored share/rootful settings appear separately as `configurationIntent`; they do not establish effective worker controls, image provenance or VM dedication. Therefore this collector cannot positively admit the current live candidate yet. Tickets 19–25 supply and qualify the remaining transfer, enforcement, authentication and recovery capabilities. Subscription usage approval is still an observation boundary, with no paid API fallback authorized.
