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

Pause/resume/cancel, isolated workers, signing and remote effects are later tickets. Their commands are not accepted yet. Windows and macOS host qualification remain unperformed; these local intake tests do not prove complete platform support.

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
