# Issue 04: native timer property decoding

Status: local implementation validation passed. Native controller-loss qualification
remains open; production execution stays disabled.

## Baseline

PR #69 merged as `a132a7456ed53709317cf11ee43dd79d20d7c5de`; its tree matches
validated head `6b8adff` exactly. All applicable PR checks and current-head human
approval checks passed. The passing suite was reused rather than rerun merely
for the merge. Local main was fast-forwarded. The confirmed squash-merged task
branch was retired after leaving it; other active/dirty worktrees were preserved.

The only check recorded on the merge SHA is a failed post-merge approval refresh
[run 39086249314](https://github.com/AJHMH/developer-os/actions/runs/39086249314).
It was triggered after merge and its trusted `checkPr` requires an open PR.
PR #69 was closed/merged; no approval was granted. It is retained as a
non-applicable approval refresh refusal, not described as a green main check or
silently rerun. Source CI runs on pull requests; its validated tree was reused.
No workflow or approval rule was changed.

## Reproduction and native evidence

The explicit offline lease procedure on the existing `aios-macos-noshare` VM
refused `observe-timer-execution` before intentional controller loss. The report
retains its fresh source/runtime pins and exact session, positive running control
and successful explicit recovery:
[failed attempt](macos/ticket04-controller-loss-lease-attempt1.json).
No expiry proof or general qualification was obtained.

A disposable `/usr/bin/true` timer on that same native manager returned:

```json
{"type":"t","data":0}
{"type":"a(sasbttttuii)","data":[["/usr/bin/true",["/usr/bin/true"],false,0,0,0,0,0,0,0]]}
```

The parser and simulator had incorrectly added an outer tuple wrapper, as if
observing a method result rather than one property. Updating the simulator to
those observed shapes made the existing public `observeTimerExecution` test fail
with the same refusal. Correcting the parser made it pass. The exact command,
false ignore-failure flag, numeric/timestamp ordering, session identity, fresh
pins and read-only behavior remain required. A new test refuses the old wrapped
shape; another accepts the native untriggered zero record.

[Raw bounded native probe evidence](native-timer-evidence/macos-property-shape-attempt1.json)
retains the diagnostic unit identity. Stopping its timer garbage-collected the
unused service, so the combined stop returned status 5. Independent subsequent
`systemctl show` observations for both exact units returned `LoadState=not-found`,
`ActiveState=inactive`, and no pending job; the separate
[cleanup observation](native-timer-evidence/macos-probe-cleanup-observation.json)
retains those values. That nonzero stop is retained rather
than called a successful stop command. No probe unit remains.

## Validation and remaining gates

All 102 focused native transport/lifecycle tests pass; both review axes report
zero actionable findings. Every original native test line remains preserved.
The first full macOS validation attempt timed out under the declared 600-second
supervisor, with successful SIGKILL process-tree termination. Bounded output was
truncated; no exact hanging test or cause is established. The failed result is
retained in [validation evidence](native-timer-evidence/candidate-validation-attempt1.json).
Unchanged main passed the same sequence in 364.1 seconds under that same
600-second profile. The host power log records Idle Sleep at 20:30:10 local,
Maintenance Sleep for 300 seconds from 20:30:23, and another 251-second sleep
from 20:35:33 during the candidate attempt. The largest retained sample gap is
299739.9 ms. A PID-bound awake assertion was attached during the comparison;
the candidate retry asserts awake from startup. Those observations justify a
fresh validation attempt, not a claim that the first run passed or that code
alone caused its timeout. The original failed record remains unchanged.
The awake candidate retry passed typecheck, formatting, the full test suite and
build in 352.9 seconds under the unchanged 600-second profile. It
reported exit zero, no timeout and no termination failure. Bounded stdout was
truncated, so no exact full-suite test count is claimed. The
[passing candidate record](native-timer-evidence/candidate-validation-attempt2-awake.json)
and [unchanged-main record](native-timer-evidence/unchanged-main-validation.json)
retain both observations. Native acceptance refuses dirty runtime source, so no candidate
native rerun is claimed before the repair is committed.

No production admission, online inference, VM provisioning, credentials, timer
limits, coverage thresholds, assertions or approval rules change. Windows and
macOS controller-loss/expiry evidence, explicit general resume, model-only access,
usage/exhaustion, dependency/resource controls and broader adversarial qualification
remain open.

The existing private investigation ledger retains the failed native observation,
red-capable public regression and repair cycle without resetting earlier usage.
