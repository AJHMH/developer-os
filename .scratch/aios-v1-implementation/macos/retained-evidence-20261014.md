# Selected historical macOS validation evidence

Reviewed 169 remaining untracked files; selected 57 for repository retention and preserved 112 unchanged locally. The [selection inventory](retained-evidence-inventory-20261014.json) records every original path, decision, byte size and SHA-256. No artifact was deleted.

These are historical observations and regression outputs from 13–14 October. The authoritative nine-check result is the [source-bound qualification report](ticket25-final-qualified-report.json), described in the [committed qualification receipt](../ticket25-macos-validation-20261013.md) for implementation snapshot `beda43ef73caec62fcc045baaf3abef9e0df99a7`. Subsequent changes require fresh native evidence; production remains disabled.

The [continuation history](ticket25-local-validation-history.md) is retained verbatim. Its then-pending and “uncommitted” statements describe the historical sequence, not current repository or execution state. Its older relative links are also preserved as originally written.

## Results that must remain refusals

`ticket25-final-assertion.log` records `macos-acceptance-incomplete`. `ticket25-final-native-completion.log` records a refused synthetic task. `ticket25-final-qualification-report.json` and `ticket25-final-report-diagnostic.json` are blocked intermediate reports. They substantiate the refusal/repair sequence and are not the final passing report.

## Evidence retained in this change

| File | Evidence category |
| --- | --- |
| [current-exec-timing.json](current-exec-timing.json) | historical-observation |
| [current-gateway-stage-diagnostic.json](current-gateway-stage-diagnostic.json) | historical-observation |
| [current-main-host-python3-tests.log](current-main-host-python3-tests.log) | historical-test-or-stage-output |
| [current-sync-failure.json](current-sync-failure.json) | historical-observation |
| [kill-exec-reproduction.json](kill-exec-reproduction.json) | historical-observation |
| [ticket25-approved-inference-execution.log](ticket25-approved-inference-execution.log) | approved-run-output |
| [ticket25-approved-synthetic-online.log](ticket25-approved-synthetic-online.log) | approved-run-output |
| [ticket25-awake-task-validation.log](ticket25-awake-task-validation.log) | historical-test-or-stage-output |
| [ticket25-before-clean-boot-gateway-diagnostic.json](ticket25-before-clean-boot-gateway-diagnostic.json) | historical-observation |
| [ticket25-before-history-headroom-diagnostic.json](ticket25-before-history-headroom-diagnostic.json) | historical-observation |
| [ticket25-before-resume-window-guest-diagnostic.json](ticket25-before-resume-window-guest-diagnostic.json) | historical-observation |
| [ticket25-bounded-credential-stop-green.log](ticket25-bounded-credential-stop-green.log) | historical-regression |
| [ticket25-bounded-credential-stop-red.log](ticket25-bounded-credential-stop-red.log) | historical-regression |
| [ticket25-bounded-effective-green.log](ticket25-bounded-effective-green.log) | historical-regression |
| [ticket25-bounded-effective-red.log](ticket25-bounded-effective-red.log) | historical-regression |
| [ticket25-bounded-worker-full-tests.log](ticket25-bounded-worker-full-tests.log) | historical-test-or-stage-output |
| [ticket25-command-window-final-tests.log](ticket25-command-window-final-tests.log) | historical-test-or-stage-output |
| [ticket25-command-window-red.log](ticket25-command-window-red.log) | historical-regression |
| [ticket25-crash-handle-regression.json](ticket25-crash-handle-regression.json) | historical-observation |
| [ticket25-current-controls-report-diagnostic.json](ticket25-current-controls-report-diagnostic.json) | historical-observation |
| [ticket25-expiry-readiness-final-tests.log](ticket25-expiry-readiness-final-tests.log) | historical-test-or-stage-output |
| [ticket25-expiry-readiness-green.log](ticket25-expiry-readiness-green.log) | historical-regression |
| [ticket25-expiry-readiness-red.log](ticket25-expiry-readiness-red.log) | historical-regression |
| [ticket25-final-after-controls-task.log](ticket25-final-after-controls-task.log) | historical-test-or-stage-output |
| [ticket25-final-assertion.log](ticket25-final-assertion.log) | historical-test-or-stage-output |
| [ticket25-final-current-controls.log](ticket25-final-current-controls.log) | historical-test-or-stage-output |
| [ticket25-final-native-completion.log](ticket25-final-native-completion.log) | historical-test-or-stage-output |
| [ticket25-final-qualification-report.json](ticket25-final-qualification-report.json) | historical-observation |
| [ticket25-final-report-diagnostic.json](ticket25-final-report-diagnostic.json) | historical-observation |
| [ticket25-fixed-scope-native-task.log](ticket25-fixed-scope-native-task.log) | historical-test-or-stage-output |
| [ticket25-gateway-activation-green.log](ticket25-gateway-activation-green.log) | historical-regression |
| [ticket25-gateway-activation-red.log](ticket25-gateway-activation-red.log) | historical-regression |
| [ticket25-headroom-final-tests.log](ticket25-headroom-final-tests.log) | historical-test-or-stage-output |
| [ticket25-headroom-green.log](ticket25-headroom-green.log) | historical-regression |
| [ticket25-headroom-red.log](ticket25-headroom-red.log) | historical-regression |
| [ticket25-history-headroom-green.log](ticket25-history-headroom-green.log) | historical-regression |
| [ticket25-history-headroom-red.log](ticket25-history-headroom-red.log) | historical-regression |
| [ticket25-local-validation-history.md](ticket25-local-validation-history.md) | historical-continuation |
| [ticket25-management-deadline-green.log](ticket25-management-deadline-green.log) | historical-regression |
| [ticket25-management-deadline-red.log](ticket25-management-deadline-red.log) | historical-regression |
| [ticket25-memory-3072-enrollment.json](ticket25-memory-3072-enrollment.json) | historical-observation |
| [ticket25-memory-3072-final-native.log](ticket25-memory-3072-final-native.log) | historical-test-or-stage-output |
| [ticket25-memory-3072-public-probe.log](ticket25-memory-3072-public-probe.log) | historical-test-or-stage-output |
| [ticket25-protocol-window-green.log](ticket25-protocol-window-green.log) | historical-regression |
| [ticket25-protocol-window-red.log](ticket25-protocol-window-red.log) | historical-regression |
| [ticket25-relay-buffer-green.log](ticket25-relay-buffer-green.log) | historical-regression |
| [ticket25-relay-buffer-red.log](ticket25-relay-buffer-red.log) | historical-regression |
| [ticket25-relay-scheduling-green.log](ticket25-relay-scheduling-green.log) | historical-regression |
| [ticket25-relay-scheduling-red.log](ticket25-relay-scheduling-red.log) | historical-regression |
| [ticket25-report-final-tests.log](ticket25-report-final-tests.log) | historical-test-or-stage-output |
| [ticket25-steady-descendants.json](ticket25-steady-descendants.json) | historical-observation |
| [ticket25-task-before-retry-refusal.json](ticket25-task-before-retry-refusal.json) | historical-observation |
| [ticket25-macos-controls-observation-before-command-window.json](../ticket25-macos-controls-observation-before-command-window.json) | historical-observation |
| [ticket25-macos-controls-observation-before-expiry-readiness.json](../ticket25-macos-controls-observation-before-expiry-readiness.json) | historical-observation |
| [ticket25-macos-controls-observation-before-headroom.json](../ticket25-macos-controls-observation-before-headroom.json) | historical-observation |
| [ticket25-macos-controls-observation-before-management-window.json](../ticket25-macos-controls-observation-before-management-window.json) | historical-observation |
| [ticket25-macos-controls-observation-before-relay.json](../ticket25-macos-controls-observation-before-relay.json) | historical-observation |

## Files kept local

Full controller/host-state snapshots, repeated enrollment/preparation outputs and intermediate diagnostics stay at their original paths. They may support future investigation and were not discarded or treated as completed work. The 112-file local-only set remains recoverable in the working directory; the inventory records their hashes but does not embed their contents.

No credentials, VM operations, inference runs, or new qualification were performed for this documentation change. Selected text was reviewed for private-key material, concrete credential assignments, authorization headers and JWTs; no such values were detected. Historical approvals are consumed receipts, not future execution permission.
