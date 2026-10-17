# Required Windows authentication setup: native process evidence

Status: PARTIAL. PR 58's Windows shard 3 failed the first authentication setup
case after 15308.319 ms. The generic refusal did not retain native subprocess
status, error code or stage. The 15000 ms storage deadline suggests a timeout,
but duration alone cannot prove it. No cause-specific repair is established.

The owner authorized a further 30 active investigation minutes after the prior
allowance was consumed, to capture this actual fixture and continue Linux I/O
attribution. The two previously unused repair cycles carry forward; neither
opening a new branch nor this extension resets their count. PR 58 head bbae420
remains untouched. Main 9096ab6 passed all native, Factory and CodeQL workflows.

## Capture boundary

Only the Windows `prepare-auth` test fixture preloads the test-only observer in
its real CLI child. An explicit Node `--import` is added before that CLI's original
arguments. The production PowerShell scripts, subprocess arguments/options,
environment, ACL/DPAPI validation and 15000 ms native deadline are unchanged.
No warmup, retry, serial scheduling, deadline increase or new assertion skip is
introduced. Test inventory and every existing assertion remain intact.

The preload records `cli-preload` entry, then fixed `initialize-directory` or
`protected-storage` stages immediately before/after each native PowerShell call.
Stage selection follows the existing fixed storage input framing, not arbitrary
path/account values. Finished records contain elapsed milliseconds, integer/null
exit status, an allowlisted signal/error code and whether native dispatch threw.
No arguments, encoded scripts, input values, paths, child output or exception
messages are logged. The parent reconstructs the closed metadata schema before
forwarding records into TAP, including on healthy executions. Original child
stdout/stderr/results and all assertions are preserved.

This observes subprocess boundaries, not internal PowerShell milestones. An
entered/start record without a finish is incomplete evidence, not proof of a
particular native instruction hanging. Diagnostics add bounded measurement cost.

## Controls and limitations

`node .scratch/auth-setup-process-evidence/verify-diagnostics.mjs` exercises real
Node subprocess success, ENOENT refusal and ETIMEDOUT, retaining original output
and error results without forwarding private canaries. A real read-only diagnostic
file descriptor raises a write failure while the original child timeout still
completes. The control passes. It tests the observer, not the historical bug.

An initial control closed process stderr itself, causing the Node subprocess
supervisor to abort; that invalid control is not native storage evidence. It was
replaced with a read-only separate descriptor, preserving the supervisor's own
standard handles. No production behavior was changed in response to that control.

The actual `tests/auth-setup.test.mjs` passes locally: five passes, one explicit
Windows-only skip on macOS. Native Windows behavior must be observed in hosted
required CI. Healthy observations cannot explain the prior failed host. Linux
actual-failure resource comparison is retained separately in
`../pr58-baseline-diagnosis/`; host I/O pressure does not identify a responsible
process/device/operation.

## Prepublication review correction

Standards review found that the Windows Node preload specifier used a drive-letter
path rather than an ESM `file:` URL. It was corrected to `new URL(...).href` before
publication. This consumes one of the two carried-forward repair cycles; one
remains. This was an observer-launch correction, not a historical storage repair.
The CLI/preload control is revalidated with a real `--import file:` invocation.

Allowance checkpoint before publication: charge ten active minutes for capture,
controls, failure comparison and review correction (CI waits excluded). Twenty
active minutes and one repair cycle remain from the new 30-minute extension.
Further continuation must carry these remaining values forward.
