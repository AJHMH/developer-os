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

## Windows handoff continuation — 11 October 2026

The Mac handoff is resumed on the Windows x64 Hyper-V host. The tested production
source revision is `e9ccc1ad744c20e8a4c003394577f28cecfba10b`; production source is
unchanged by this continuation. The native driver was independently re-enrolled
with a new external `pins-windows-20261011.json` policy; prior policy files are
preserved. The dedicated machine is `aios-podman-noshare`, and its existing
synthetic authority is `$HOME/.developer-os/ticket19-native/state`.

The explicit Windows acceptance scripts use the approved public controller seam
and the serial `scripts/run-native-acceptance.mjs` lock. They do not provision a
machine, run candidate scripts, copy credentials, or authorize inference. Run:

```powershell
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket19-native/state" .scratch/aios-v1-implementation/windows-roundtrip-acceptance.mjs .scratch/aios-v1-implementation/windows-fencing-acceptance.mjs .scratch/aios-v1-implementation/windows-isolation-acceptance.mjs -- 46f3cefb-57e3-48fa-be4f-24fae4b37505 "$HOME/.developer-os/ticket19-native/pins-windows-20261011.json"
```

The resumed Windows automatic suite passes 160 tests, with one skipped
macOS ACL observation (161 total). Typechecking passes. Windows test fixtures now use
native file URL conversion, directory junction aliases and durable interruption
lock behavior; POSIX mode/file-symlink assertions for the macOS-only mediation
fixture remain platform-specific. These fixtures do not establish Windows ACL or
authentication qualification.

Native acceptance outcomes and the public qualification snapshot are recorded
below after the serial suite finishes. The complete ticket stays open:
Windows authentication mediation, online endpoint/dependency enforcement,
allowance/inference authorization, a production synthetic task and isolated
production validation are not established by this offline subset. macOS
subscription evidence cannot qualify the Windows binding.

### Native outcomes

All three serial acceptance steps passed. Retained evidence:
- [Round trip](ticket24-windows-roundtrip.json): six input/pin/refusal/recovery checks and verified result collection.
- [Fencing](ticket24-windows-fencing.json): concurrent ownership, stale sender, pause and killed-controller recovery; four censuses each observed eight processes and zero remaining.
- [Isolation](ticket24-windows-isolation.json): six synthetic denial controls with positive controls and four bounded escape attempts.
- [Public report](ticket24-windows-qualification.json): host binding and offline transfer pass; outcome remains blocked and productionEnabled false.

The public report marks complete adversarial isolation failed because the full
required probe set is not established by six synthetic denial controls. Its
fencingRecovery aggregate stays not-run because not every required durable
qualification probe is populated; the separate native lifecycle evidence is
positive but does not replace missing report controls. Authentication, online
policy, usage, production syntheticTask and isolatedValidation remain not-run.
No active worker containers remained in the dedicated VM after acceptance.

Initial attempts are not successful evidence: the first copied round-trip script
retained an AppleHV assertion and failed after safe worker shutdown; it was
corrected to require Hyper-V and all three steps repeated serially. Automatic
Windows tests first exposed URL-path, directory-link, signal-message and POSIX
permission assumptions; these were corrected before the final successful suite.

Code review found no blocking Standards or Spec issues. Optional duplication in
explicit platform acceptance fixtures was retained for consistency with the
existing separate Mac/Windows runners. Complete ticket 24 acceptance remains open.
