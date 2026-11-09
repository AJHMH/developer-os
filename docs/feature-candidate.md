# Bounded feature candidates

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket 05 adds a controller slice through the existing public command/observation boundary. It prepares criteria, records a feature branch from a clean admitted Git revision, drives a configured controlled coding adapter, and stores a candidate only after verified descendant shutdown. Ticket 06 adds local controlled validation; signing, publication and completion remain gated.

The integration boundary is `DeliveryController`, with owner-supplied `featurePlanner` and `featureRuntime` adapters. They are trusted host integrations, never loaded from repository text or worker output. Only `mode: controlled` is currently accepted. On the CLI (ADR 0004), `plan-feature` uses the owner's criteria file and `code-feature` the owner-admitted native coding and validation runtimes, optionally routed through the owner's authorized account; each refuses without its owner inputs. Controlled tests do not establish native isolation, CLI compatibility or provider authorization. Ticket 04 and later native qualification gates remain open.

## Public lifecycle

- `start({repository, request, codingMinutes?})` records an optional initial allowance. Default: 120 active minutes; supported initial values: 1–1440 minutes. The CLI accepts `start --coding-minutes N`.
- `planFeature(id)` records observable criteria and relevant verification through the trusted planner. Material ambiguity produces `needs-info` and does not create a branch or dispatch coding.
- `clarifyFeature(id, text)` retains an explicit owner clarification and re-plans without rewriting the original request. CLI: `clarify-feature --id ID --clarification TEXT`.
- On the CLI the v1 planner is the owner's private criteria file (ADR 0004): `plan-feature --id ID --feature-criteria FILE` and `clarify-feature ... --feature-criteria FILE`. The file, outside every repository, names scope `aios-feature-criteria-v1`, the delivery id, the exact request and any clarifications verbatim, and `criteria`, `verification`, `ambiguity` and optional `requires`. A file for another delivery, request or clarification plans nothing.
- The CLI observes only local repository hints, so the other onboarding facts come from the owner's private attestation (ADR 0004): `--onboarding-attestation FILE` with `--owner-policy` on `start`, `validate-baseline`, `validate-candidate` and `code-feature`. The record names scope `aios-onboarding-attestation-v1`, the owner policy's SHA-256, `attestedAt` and `facts` (the observation fields other than the local hints). Inspected facts always outrank attested ones. Matching attested facts have status `attested`, never `verified`, and the report records the attestation's SHA-256. They admit controlled delivery only, never production. An attestation for another policy, with local hints, or malformed is refused as a policy conflict. Protections verify only with `forcePushBlocked: true`, `signedCommitsRequired: true` and `everyPullRequestReviewRequired: false`. The controller's change gate, not a blanket GitHub review rule, decides which heads need the owner (ADR 0005). An attestation without these facts leaves protections unverified. The owner policy may declare `changeGate` (`maxFiles`, `maxLines`, `authorityPaths`, `dataPaths`). Without it the default applies. The report records the contract's digest, and reviews read it from the pinned policy at use.
- On the CLI, `validate-baseline` and `validate-candidate` take `--validation-admission <owner-record>` with `--podman-machine` to install the owner-admitted native validation runtime (ADR 0004): the record's pins and image, and the authority the native acceptances use. Checks run offline, with no dependency installs. `pause`, `cancel` and `recover` take the same options to stop the exact native validation attempt. A missing or invalid record refuses before any delivery state or VM effect.
- `codeFeature(id)` checks onboarding and owner policy, clean unchanged main, passing revision-bound baseline validation, coding pins and stopped session state. It records operation intent before creating `aios/feature-ID` (a delivery that began coding under Codex keeps `codex/feature-ID`), leaves the host checkout untouched, and supplies plain admitted files rather than host Git metadata.
- On the CLI, `code-feature --id ID` takes `--owner-policy` (with optional `--onboarding-attestation`), `--podman-machine` with `--coding-admission` and `--validation-admission`, `--codex-executable` for usage, and optional `--coding-minutes 1..1440` for the first session. Without a qualified mediation decision the turn is offline: no model access, proving only the delivery mechanics. With `--auth-directory` and `--auth-account` (given together), a mediated delivery's turn is routed through a host-only `GeneralSessionGateway` with the owner's authorized vault account. The host registration is read when the command starts and the vault only at a model request; a turn for another account opens no session. A routed turn still needs a qualified mediation decision, fresh usage authority at every model request and the owner's one-shot approval (ADR 0002). `prepare-routed-turns --id ID --podman-machine M --coding-admission FILE --auth-account ACCOUNT --turns 1|2` writes a private plan to the controller state, bound to that delivery, account, VM and coding pins, and prints its run ID; it lapses after an hour. A routed `code-feature` must name it with `--approve-run RUN --approve-turns N`; a mismatch refuses before anything starts. It also takes the fixed worker's `--worker-policy` with `--adversarial`, because each dispatch re-qualifies the delivery and its mediation decision with the same probe that qualified it (`qualify --adversarial`); without them the decision would not qualify. Each routed turn spends one approved turn before its gateway opens, so no run takes more turns than the owner approved. An admitted candidate still ends at `DELIVERY_NOT_ENABLED`.
- With a Claude Code coding record (ADR 0008), `code-feature` and `repair-feature` take `--auth-directory DIR` alone, with no account, approval or `--codex-executable`. Each turn is metered through a host-only `MessagesGateway` that holds the owner's Anthropic key (`store-anthropic-key`). The key is read from the Keychain only at a model request. The delivery's spend budget is the turn's only model authority: no usage is read, and no mediation decision, usage approval or restart approval applies. The turn records route `{deliveryId, decisionSha256}`, where the digest names the delivery's budget (`budgetRouteSha256`), so every turn of the delivery resumes under the same route. A request the budget refuses is a budget interruption. The turn stops at once, its workspace is kept only as `interrupted-turn` evidence, and coding refuses until `extend-budget`. The next `code-feature` then resumes the same conversation. A request left reserved by a stopped session is charged in full before coding continues.
- `pause`, `cancel`, `recover` and `release` retain the existing ownership/fencing rules and also reconcile coding shutdown. An uncertain coding worker blocks import, resume and ownership release. On the CLI, `pause`, `cancel` and `recover` take `--coding-admission <owner-record>` with `--podman-machine` to install the owner-admitted native coding runtime for that; without it a running coding session is left uncertain.
- `extendCoding(id, minutes)` is an explicit owner control for stopped exhausted work. CLI: `extend-coding --id ID --minutes N`. It appends the changed allowance; worker output cannot request an extension.

## Coding and candidate evidence

`PinnedCodingRuntime` checks executable and binding measurements through the trusted `IsolatedCodingTransport`, bounds and decodes fragmented JSON output, and checks the complete transcript and exit result. The transport must enforce isolation, use argv without a shell, and recheck pins at dispatch. The adapter binds operation/session identity, source/branch, pins, arguments, allowance, admitted file hashes and baseline-refresh payloads across asynchronous inspection; changed launch data is refused before worker dispatch. The transport receives an owned copy of arguments, pins and admitted bytes, including baseline-refresh manifests; inspection references cannot rewrite that prepared input. Controller callbacks cannot be replaced during inspection. The frozen request retains guarded dispatch/checkpoint callbacks that verify the prepared binding before and after fresh controller authorization, and stream/result admission also checks that binding. A transport must call `mayDispatch()` immediately before each worker effect after asynchronous preparation and independently remeasure native pins at that effect; copying data alone cannot qualify a native transport. This local binding does not supply native qualification or credential authority. No native transport is supplied; actual pinned CLI compatibility remains an open qualification requirement.

The adapter receives the exact pinned version/digest, isolated input manifest, explicit start/resume intent and bounded active allowance. The command contract uses noninteractive `exec --json` and an explicit saved thread ID for resume. It never uses global last-session selection. Supported structured events are projected to the session identity and terminal success/failure; reasoning, command output and error text are not retained as controller authority. A valid session-start observation is durable even when transport fails before a terminal result.

Active time is checkpointed in the real ledger and checked while coding. Paused time, stopped collection and restart downtime do not reset or add to the saved allowance. A restart cannot blindly dispatch a running/uncertain session: recover its exact operation first. The coding allowance is distinct from short management observation timeouts.

Input admission disables Git hooks, system/global attributes and optional index writes, refuses local and worktree filters/includes, and verifies ordinary admitted source bytes against the selected revision. Dirty work, unsafe source paths and linked inputs are preserved and refused. No repository validation scripts run on the host.

Output collection is possible only after matching shutdown evidence reports zero remaining processes. The pinned adapter always attempts exact-session shutdown, then refreshes independent pins before trusting its receipt. For a live transport it also needs the guest's independent census of that exact session: phase `stopped`, not running, no remaining process, every recorded process gone and no timer active. A session stopped before it was ever prepared observes as stopped with no container. A mismatch or failed observation leaves shutdown uncertain, which blocks collection, resume and release until exact-session recovery. Overlapping stops of one session, such as a pause racing the turn's own stop, are serialized by the guest's management lock; once one is observed the session stays stopped, and an earlier unobserved stop is superseded by a later observed one. It also refreshes independent pins immediately before and after asynchronous collection, refusing dispatch or candidate admission on drift. Management requests use frozen session copies. These checks bind observations; native management must still independently prove descendant/cgroup shutdown and stopped ordinary-file collection. The management adapter must attest a complete ordinary-file inventory with independent before/after hashes. Traversal, Git metadata/hooks, linked/reparse output, duplicate paths, oversized or credential-like content and changed output refuse admission. Policy, source and branch are rechecked after collection before persisting a candidate. A turn ended by a usage interruption is collected only as `interrupted-turn` evidence (`artifacts/interrupted-<operationId>.json`), never as a candidate, and its stopped thread stays resumable after the owner's restart approval. Each session records its route (`route`: delivery and mediation decision, absent offline). A restart resumes only under the same route; otherwise coding starts a new lineage and records the old one in `supersededLineages`, never to be resumed. The owner may later remove a superseded lineage's guest folders and stopped containers with `cleanupSupersededLineage(id, operationId)`: the guest marks its head never to be resumed and keeps every record as a tombstone, and the entry records `cleanedAt` and `cleaned` once.

The admitted candidate records a SHA-256 of its complete manifest, original input identity, source revision, feature branch and policy/CLI/host pins in durable state. Its validation status is explicitly `not-run`. The [isolated validation slice](isolated-validation.md) must validate the exact candidate before signing or publication. Production delivery remains disabled.

## Owner-run CLI acceptance (ADR 0004)

`scripts/run-native-cli-delivery-acceptance.mjs` runs one metered delivery through the real CLI on Claude Code (ADR 0008). Each step is its own `dist/cli.js` process, given only the owner inputs that command names:

1. `start`, with a $5 spend budget (`--budget-dollars 5`)
2. `plan-feature`
3. `validate-baseline` on the owner-admitted validation runtime
4. `code-feature` on the owner-admitted Claude Code and validation runtimes, with `--auth-directory` naming your stored Anthropic key
5. `validate-candidate`

The script writes the repository, owner policy, onboarding attestation and criteria file itself. They are synthetic, private and outside every repository, and the report labels them so.

The coding turn is Claude Code's, metered through your Anthropic key against the delivery's spend budget. It sends real, paid model requests, and the gateway refuses any request once the $5 budget can't cover its worst case, so the run spends at most $5. The budget is set above the expected cost because each request first reserves its worst case: Claude Code asks for up to 128,000 output tokens per request, which alone reserves $2.56. The run passes only when the turn stops exactly, is authorized by the budget alone, charges its requests within the budget, and admits a candidate that then passes validation. The host checkout must stay on unchanged `main`, with the feature branch still at the baseline. If the budget interrupts the turn, the run is `blocked` and the report says so; the work stays in the delivery's state.

Before any CLI step, the run reads the VM's fresh coding and validation pins and checks that both admission records name them. The coding record must be your Claude Code record (`claude-coding-admission.json`). If either record is stale, for example after a guest program change, it stops there and prints the fresh pins, so that you can check or rewrite the record. A stale record otherwise refuses the coding turn and leaves its stop unverifiable.

The run never reads the key itself and never starts the VM. Any open session is stopped by its exact identity before the run ends; if that stop can't be verified, the outcome is `uncertain`. A passing run then removes the coding session from the VM by its exact identity; a blocked run keeps it for diagnosis. The CLI's delivery state stays in the printed `state` directory as evidence, including the delivery's spend ledger. Run it from a fresh build of `main`.

In Terminal:

```sh
cd ~/Repos/developer-os
git switch main && git pull --ff-only
npm ci --ignore-scripts && npm run build
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-cli-delivery-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" "$HOME/.developer-os-auth" "$HOME/.developer-os/issue04-cli-delivery-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-metered-native-run
```

### Native results (9 November 2026)

The Mac passed with outcome `observed-metered-cli-delivery-acceptance`, from `main` at `13a88c9` with this change applied:

| Host                         | Baseline            | Coding turn                                                                | Candidate           |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------- | ------------------- |
| macOS (`aios-macos-noshare`) | 5 of 5 checks, 28 s | Claude Code, stopped exactly, `admitted` in 28 s; 6 requests, $0.069 of $5 | 6 of 6 checks, 33 s |

The budget did not interrupt the turn, and no request was left reserved. The host checkout stayed on unchanged `main`, the feature branch stayed at the baseline, and production stayed disabled. Reaching this pass needed:

- accepting Console personal API keys (`sk-ant-usr-`), which the key check had refused;
- an auth directory outside the CLI's default state directory (`$HOME/.developer-os-auth`);
- a budget above Claude Code's first reservation. With a $1 budget the first request, which asks for 128,000 output tokens and so reserves $2.66, was refused before it was sent.

### Native results on Codex (1 November 2026)

Before the move to Claude Code, the offline Codex version of this run passed with outcome `observed-offline-cli-delivery-acceptance`, from clean `main` at `84b80d7`:

| Host                         | Baseline            | Coding turn                                                                | Candidate           |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------- | ------------------- |
| macOS (`aios-macos-noshare`) | 5 of 5 checks, 31 s | thread reported, stopped exactly, `exhausted` after its 5-minute allowance | refused, no attempt |

The previous pass, on 31 October, was at `81eb317`.

The turn was not routed and admitted no candidate. The host checkout stayed on unchanged `main`, and production stayed disabled. Reaching these passes needed:

- a fresh coding admission record (the coding guest program changed in PRs 155 and 157);
- the pinned `codex` for usage (PR 165);
- a 5-second wait for the usage reader's `codex` to exit (PR 181). Before it, a slow exit meant the read was discarded as `stop`, usage read as unknown and the turn never dispatched.

At the time, a validated candidate needed a routed live Codex turn under the owner's one-shot approval.

## Owner-run routed live turn

`scripts/run-native-routed-delivery.mjs` runs one delivery to a routed live turn through the real CLI, in the VM's authority state (`docs/owner-hosts.md`). The repository, owner policy, attestation and criteria are synthetic, as in the CLI acceptance, and are written to a private folder beside the state. It runs as four commands, so each approval is yours, given in between:

1. **`prepare`**: `start`, `plan-feature`, `validate-baseline`, the fixed worker's `qualify --adversarial`, and a planned decision inference. It reads no credential and sends nothing live. It prints the session file and the decision run ID.
2. **`decide`**: spends your approval of that run. It sends one live request through the host-only gateway and records the delivery's mediation decision (`docs/operator-tools.md`), then prints the usage account it observed. If reading that usage account is refused, run `decide` again with the same approval once the read works: it finds this run's decision record and goes straight to the usage read, sending nothing.
3. **`route`**: endorses that usage account once you've checked it's yours, re-qualifies until the decision qualifies, and prints the routed run ID for the turns you name (1 or 2).
4. **`code`**: spends your approval of the routed run on a routed `code-feature` turn, which sends live model requests. It validates an admitted candidate, stops anything left open by its exact identity, and writes `report.json` in the session folder. The outcome is `observed-routed-validated-candidate`, `observed-routed-turn-without-candidate`, `blocked` or `uncertain`.

Production stays disabled: a validated candidate still ends at `DELIVERY_NOT_ENABLED`, and nothing is published. Start from a fresh build of clean `main` with the VM running. Quit Podman Desktop first: with it open, qualifies slow down and stop at varying stages (`docs/macos-worker-qualification.md`). Quitting can stop the VM, so check that it's still running. `prepare` also prints a warning if it finds the app running, then carries on.

In Terminal, set `WORKER_POLICY` to the fixed worker's pins, `AUTH_DIR` and `AUTH_ACCOUNT` to your authorized account, then `SESSION`, `DECISION_RUN`, `USAGE_ACCOUNT` and `ROUTED_RUN` from each step's output:

```sh
H="$HOME/.developer-os"
node scripts/run-native-routed-delivery.mjs prepare --state-dir "$H/ticket4-macos/state" --podman-machine aios-macos-noshare --worker-policy "${WORKER_POLICY:?}" --coding-admission "$H/admission/coding-admission.json" --validation-admission "$H/admission/validation-admission.json" --codex-executable "$H/ticket4-macos/runtime/codex-0.161.0" --auth-directory "${AUTH_DIR:?}" --auth-account "${AUTH_ACCOUNT:?}"
node scripts/run-native-routed-delivery.mjs decide --session "${SESSION:?}" --approve-run "${DECISION_RUN:?}" --approve-unknown-usage
node scripts/run-native-routed-delivery.mjs route --session "${SESSION:?}" --expect-usage-account "${USAGE_ACCOUNT:?}" --turns 1
node scripts/run-native-routed-delivery.mjs code --session "${SESSION:?}" --approve-run "${ROUTED_RUN:?}" --approve-turns 1
```

### Routed repair evidence

When `code`'s candidate fails validation (its report's `candidateValidation.outcome` isn't `passed`), two more commands record one routed repair turn on the same delivery. That's the native evidence for slice 1 of the Issue 04 plan:

5. **`plan-repair`**: checks through `status` that `repair-feature` would accept the delivery: a routed candidate whose session stopped, whose own tree failed validation, with no repair or validation attempt still open. Then it plans a fresh routed run of exactly one turn and prints its run ID. It sends nothing live. It refuses a candidate that passed, or a delivery without one: then there's nothing to repair, and repair evidence needs a run whose candidate fails.
6. **`repair`**: spends your approval of that run on one routed `repair-feature` turn, which sends live model requests and revalidates the candidate. It stops anything left open by its exact identity and writes `repair-report.json` beside `report.json`. The outcome is `observed-routed-repair-validated`, `observed-routed-repair-still-failing`, `blocked` or `uncertain`. A repair that still fails is evidence too: a new routed turn ran, and its result was revalidated. The report is `blocked` when no new repair turn was coded, the turn wasn't routed, or the repair ended without its own revalidation, for example `interrupted` or `exhausted`.

With `REPAIR_RUN` from `plan-repair`'s output:

```sh
node scripts/run-native-routed-delivery.mjs plan-repair --session "${SESSION:?}"
node scripts/run-native-routed-delivery.mjs repair --session "${SESSION:?}" --approve-run "${REPAIR_RUN:?}"
```

### If the repository is held

Every routed run uses the same synthetic repository, and a delivery keeps holding it until it's released, even after a successful run. While it's held, the next `prepare` queues its new delivery and stops at `plan-feature` with `Resolve controls before planning this feature.` A refused `prepare` leaves its delivery holding the repository too, and so does an interrupted baseline. An interrupted baseline also leaves its validation attempt open, and `release` refuses until that attempt has stopped.

This lists the deliveries that hold a repository or are queued for one. Routed runs show the key `github:ajhmh/acceptance-page`:

```sh
STATE_DIR="$HOME/.developer-os/ticket4-macos/state"
node dist/cli.js status --state-dir "$STATE_DIR" | node -e 'for (const d of JSON.parse(require("fs").readFileSync(0)).deliveries) if (d.ownership.held || d.phase === "queued") console.log(d.id, d.phase, d.ownership.key)'
```

Set `DELIVERY_ID` to the holder. If its baseline was interrupted, first stop that exact attempt:

```sh
H="$HOME/.developer-os"
node dist/cli.js cancel --id "${DELIVERY_ID:?}" --state-dir "$STATE_DIR" --podman-machine aios-macos-noshare --validation-admission "$H/admission/validation-admission.json" --coding-admission "$H/admission/coding-admission.json"
```

Then release it:

```sh
node dist/cli.js release --id "${DELIVERY_ID:?}" --state-dir "$STATE_DIR"
```

Releasing hands the repository to the oldest queued delivery, which a refused `prepare` may have left behind. List again and release that one too, until no routed delivery holds the repository or is queued.
