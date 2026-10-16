# Windows worker qualification

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Use this runbook when preparing, resuming or reviewing native Windows acceptance.
Automatic CI runs the credential-free suite on Windows, macOS and Linux. Native
VM acceptance, protected account inspection and inference are explicit operator
actions outside CI.

The public report now explicitly emits `scope: "fixed-worker"`. Its qualified
outcome applies only to that worker evidence; it does not close complete-controller
[issue 15](../.scratch/aios-v1-implementation/issues/15-windows-qualification.md).
See the [complete-controller acceptance matrix](../.scratch/aios-v1-implementation/ticket15-implementation-plan.md)
for missing native prerequisites and required Windows observations.

## Current entry points

- `node scripts/run-windows-qualification.mjs`: the phased operator runner.
- `node dist/cli.js auth-status`: separate read-only protected account inspection.
- `node scripts/assert-windows-qualification.mjs`: final public report assertion.
- `scripts/run-native-acceptance.mjs`: existing individual-script runner. Both
  runners use the same canonical-state `.native-acceptance.lock`.

Ticket 24's recorded fixture scripts and receipts live under
`.scratch/aios-v1-implementation/`. The `windows-resume-*` and
`ticket24-windows-resume-gateway-inference.mjs` scripts are the last completed
fixture; `ticket24-windows-gateway-inference.mjs` is an older historical runner.
Historical scripts contain fixed owner paths and pins. Before a new run, prepare
reviewed copies with the intended repository, state, delivery, account, policy
and distinct receipt paths. Keep originals and refusals intact. The manifest
pins each reviewed copy's bytes; it does not configure constants inside a script.

## Prepare the operator manifest

Build and validate the final source before enrollment or preparation. Use an
independently enrolled ordinary external policy for the dedicated Hyper-V VM,
with controller state outside the candidate repository. The host owner supplies
the configuration; candidate files are not approval or trusted configuration.

Create an ordinary JSON file outside the candidate. Its exact shape is:

```json
{
  "schema": 1,
  "stateDirectory": "C:/absolute/external/state",
  "steps": {
    "controls": {
      "script": "D:/absolute/reviewed/controls.mjs",
      "sha256": "<sha256>",
      "args": []
    },
    "authStatus": {
      "script": "D:/repos/developer-os/dist/cli.js",
      "sha256": "<sha256>",
      "args": [
        "auth-status",
        "--repo",
        "C:/absolute/candidate",
        "--state-dir",
        "C:/absolute/external/state",
        "--auth-directory",
        "C:/absolute/protected/auth",
        "--auth-account",
        "<account-id>"
      ]
    },
    "prepareInference": {
      "script": "D:/absolute/reviewed/inference.mjs",
      "sha256": "<sha256>",
      "args": ["--policy", "C:/absolute/external/pins.json"]
    },
    "inference": {
      "script": "D:/absolute/reviewed/inference.mjs",
      "sha256": "<sha256>",
      "args": ["--policy", "C:/absolute/external/pins.json"]
    },
    "capability": {
      "script": "D:/absolute/reviewed/capability.mjs",
      "sha256": "<sha256>",
      "args": []
    },
    "task": {
      "script": "D:/absolute/reviewed/task.mjs",
      "sha256": "<sha256>",
      "args": []
    },
    "online": {
      "script": "D:/absolute/reviewed/online.mjs",
      "sha256": "<sha256>",
      "args": []
    },
    "report": {
      "script": "D:/repos/developer-os/scripts/assert-windows-qualification.mjs",
      "sha256": "<sha256>",
      "args": [
        "--state-dir",
        "C:/absolute/external/state",
        "--id",
        "<delivery-id>"
      ]
    }
  }
}
```

Obtain each script hash with `(Get-FileHash -Algorithm SHA256 -LiteralPath

<script>).Hash.ToLowerInvariant()`. All eight steps must exist and match their
hashes. Arguments belong to individual steps. Approval and execution flags are
supplied to the runner at invocation, never saved in the manifest. Configuration
and script hashes are operator review inputs, not substitutes for the driver's
VM, policy, account or exact-plan checks.

## Run one phase at a time

1. Preview any phase with `--manifest <file> --phase <prepare|inference|complete>
   --plan`. Planning reads script/configuration bytes, starts no child, creates
   no state lock, opens no credential store and grants no approval.
2. Explicitly run `--phase prepare`. It runs controls, read-only auth status, then
   credential-free inference preparation. It stops with `approval-required`.
   Auth status exposes only eligibility booleans. Expired, insufficient-lifetime,
   unavailable or unapproved accounts stop the phase. Separate browser sign-in
   remains an owner action; no automatic refresh occurs.
3. Review and approve the exact prepared plan. Run `--phase inference --approve-run
   <exact-run-id> --approve-unknown-usage` only with the owner's approval of that
   run and unknown usage. Auth status is checked again first. The inference
   script must retain durable one-shot consumption and all source/pin/account/
   request/expiry checks. A status check cannot reserve token lifetime: drift or
   later expiry still refuses safely, and consumed approval stays consumed.
4. Obtain a separate one-run synthetic usage allowance. Run `--phase complete
   --approved-synthetic-unknown-usage`. This sequences capability endorsement,
   the fixed task, synthetic online controls and final report assertion. The
   allowance flag goes only to the online step. That step must persist positive
   account qualification before its final native preflight, then obtain and
   approve a fresh usage check immediately before dispatch.

Every refusal stops the phase; the runner retries no stage and refreshes no
token. Inspect current state and preserve the refusal before deciding on another
explicit attempt. Never carry consumed approvals into a new plan or run. Source,
VM, policy, worker or account drift requires the relevant fresh qualification and
approval. Production remains disabled regardless of phase success.

## Diagnose and finish

The runner emits fixed stage names with `started`, `waiting`, `passed` or
`refused`, bounded elapsed times and `productionEnabled: false`. It emits waiting
progress every 30 seconds. Agents should wait 30–60 seconds for terminal output,
summarize new stage results, and avoid repeated empty-output polling. Stages have
a ten-minute operator watchdog; interruption retains the shared lock. Verify
runner and worker shutdown before manually removing a retained lock.

Native failed probes may record `workerDiagnostic`: bounded elapsed/command
times, fixed failure kinds, exit codes and original/surviving Codex process
counts. Fields are allowlisted; raw stderr, commands, paths, tokens and PID
identities are excluded. Cleanup cannot overwrite the first probe failure.
Diagnostics explain a refusal and never establish a passing control. Investigate
intermittency rather than treating a passing repeat as an explanation.

Completion requires the current public report to pass all nine live Windows
checks and every current/retained offline and online session to be stopped.
Preserve the final report, fixed inference receipt, controls/task/online evidence,
refusals, source revision and external pin identifiers. Historical evidence stays
historical: the diagnostics change alters native source/policy bindings, so the
ticket 24 report from `1c0f614` does not qualify this changed build. Re-enrollment
and fresh owner-authorized native acceptance remain required before using it.
General delivery, pilot qualification, signed publication, approval and merge
remain separate downstream gates.
