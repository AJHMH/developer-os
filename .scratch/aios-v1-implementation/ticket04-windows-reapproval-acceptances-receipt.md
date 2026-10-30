# Issue 04: Windows re-approval and offline acceptances after PRs 139 and 143

30 October 2026. Windows x64, Hyper-V VM `aios-podman-noshare`, Podman client
6.1.4. No inference, no credentials, no usage spent. Each report keeps
`productionEnabled` and `qualified` false and records its own source revision.

## Re-approval

PR 139 changed the coding guest program and PR 143 the validation guest
program. The policy pin hashes the guest program, which is constant source
with LF line endings, so the Windows pins equal the Mac's:
- coding `7b587bd9be1e001b9d7b2c920454cb63790adc82928aaa73de7cc78f2f64f16b`;
- validation `585cd02cc6a9eff07e8e4f1f16d96719b3f24f40f0f7f57b349a7c0d1927448f`.

The admission acceptances first stopped before any VM effect and printed
fresh pins. Every other pin matched earlier Windows receipts: CLI
`9a820c17…`, code-mode host `e8709608…`, coding binding `f6dbbfd8…`, image
`c83674e1…`, validation binding `7e94bc11…`. The owner re-approved both
records. A first edit wrote `approvedAt` without milliseconds; the runner
accepts only the canonical form (`…:21.000Z`), so the record was refused until
that was fixed.

## Host fixes before the runs

None changed the VM, its pins or the repository.
- **Stale `gvproxy` socket.** `%LOCALAPPDATA%\Temp\podman\aios-podman-noshare-api.sock`,
  left from 27 October, made `gvproxy` exit at start, so the VM ran but its
  SSH and API forward on port 53460 refused connections. Deleting it with the
  VM stopped fixed it, as in two earlier Windows receipts.
- **VM SSH key permissions.** Windows OpenSSH ignored
  `.local\share\containers\podman\machine\machine` because
  `MSI\CodexSandboxUsers` inherited read access. The owner limited the key to
  their account.
- **Codex sandbox access to Podman's folder.** That group has an explicit
  read grant on `C:\Users\mraar\.local`, inherited by everything below,
  including the VM disk images. The owner removed the group from
  `.local\share\containers` and everything inside. The grant on `.local` itself
  remains the owner's choice; a Codex update could re-add access below it.

## Runs

All reports are under `C:\Users\mraar\.developer-os\`. The first three ran from
`main` at `95e8fc1`; the canary's passing run from `840ac2f`.

| Acceptance | Outcome | Report | SHA-256 |
|---|---|---|---|
| Coding admission | `observed-offline-admission-acceptance` | `issue04-admission-acceptance-20261030-140910.json` | `4a7714f08ab17752a0658b317340cc15a3c33fd581644b3400728d0e449a9a8c` |
| Validation admission | `observed-offline-validation-admission-acceptance` | `issue04-validation-acceptance-20261030-141329.json` | `c46ab9f6c3cfcfff8cd5ae42fc1ff4829d8832fc627f5301f039bcfcbd0a12ac` |
| Session (lineages A and B) | `observed-offline-session-acceptance` | `issue04-session-acceptance-20261030-135441.json` | `39d0e036e753ca44a2df4547325c231e34b6360de7c749b4dfa90136e2cd8e88` |
| Usage canary | `observed-offline-usage-canary` | `issue04-usage-canary-20261030-175837.json` | `14204f59d67e44464529e8be80fead08dae9f73e5eee77766133cc99cafe2efa` |

The usage canary passed all 10 stages, including exhaustion mid-turn,
restart refused without approval, withdrawal mid-turn on resume, and a new
lineage for a new decision. It is the first passing Windows run.

## What the canary found

Three earlier canary runs blocked; their reports are kept beside the others.
- `…-140536.json` and `…-141641.json` (from `95e8fc1`): the first at
  `owner-record-names-fresh-pins` (the timestamp format above), the second at
  `synthetic-decision-qualified`. The canary kept its disposable controller
  state under `%TEMP%`, which on this PC grants `CodexSandboxUsers`, two other
  local accounts and an app-container identity inherited access; the
  controller rightly refused a decision record there. PR 146 makes the canary
  lock down its own root.
- `…-145657.json` (from `d21dd73`): at `routed-launch-exhausted-mid-turn`. The
  slow launch outlasted the 60-second age limit of the low-usage approval,
  which the gate rechecked mid-turn, so the turn ended as `approval-required`
  after one request. Any approved low-usage turn longer than a minute was cut
  off this way on either host. The owner decided a bound approval covers its
  whole dispatched coding turn; PR 147 implements it, with fixed workers and
  online runs keeping the 60-second limit.

Both hosts have now passed all four offline acceptances on the current pins
(macOS in the [macOS re-approval receipt](ticket04-macos-reapproval-acceptances-receipt.md)).
The macOS canary ran before PR 147; its behaviour on macOS is unchanged
because its launch finishes within 60 seconds.

## Not covered

- The slice 5 live credentialed runs, which spend usage, on either host.
- A native run of the npm dependency install, which needs an owner-loaded,
  digest-pinned image with `npm`.

Production remains disabled.
