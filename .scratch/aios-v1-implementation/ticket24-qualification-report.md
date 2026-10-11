# Ticket 24 Windows qualification report

`DeliveryController.qualificationReport(id)` and CLI
`qualification-report --id <delivery-id>` emit the latest version-bound Windows
worker qualification snapshot without running probes or changing delivery
authority. The report records target platform/provider, observed VM and worker
versions, binding and policy hashes, and separate results for host admission,
offline transfer, adversarial isolation, online policy, authentication, usage,
fencing/recovery, a synthetic worker task and isolated validation.

Every gate is marked `passed`, `failed` or `not-run` and includes its evidence
mode. Controlled Windows adapters can exercise matching and refusal behavior,
but a report with controlled evidence remains `blocked`. macOS AppleHV evidence
cannot satisfy the Windows Hyper-V target. Missing proofs stay `not-run`; the
report never enables production delivery.

This Mac provides Darwin arm64 and AppleHV, not a Windows Hyper-V host. Ticket 24
native Windows transfer, online-policy, authentication, usage and recovery
qualification was not run. Windows authentication mediation, a synthetic worker
task and isolated validation also remain not-run. No provider inference was
executed. The ticket remains open for native Windows qualification.
