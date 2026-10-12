# PR 11 validation repairs

Base for corrective review: b8272e4317ce04e1cde37470cc3c68fd8d07dd91.

Hosted macOS CI rejected fixture paths under the /var temporary-directory alias.
Tests now create their manifests/scripts under realpath-resolved temporary roots;
production canonical-path rejection is unchanged.

Hosted Factory coverage measured 63.46% changed lines and 88.74% global lines,
below unchanged policy. Added portable public host-adapter tests cover synthetic
Windows protected-store create/replace/readback/refusal, fixed task staging and
exact stopped collection, and Windows boundary/revoked-sender/killed-controller
orchestration. Real HostAdapter probing and the controller run with fake OS
boundaries; the disposable child controller is killed and its session reconciled.
No PowerShell, Podman, owner credentials or real inference is used.

Independent Standards review cleared its owned-class mocking concern after the
internal probe mock was removed. Spec review found no corrective findings.
Both axes have zero open findings. Hosted validation still requires confirmation
on the published head; owner approval is intentionally not supplied by the bot.

Validation: typecheck, formatting and staged whitespace checks passed. Full
credential-free Windows suite: 191 tests, 190 passed, one macOS-only ACL skip.
Final coverage-instrumented suite also passed; aggregate compiled-source line
coverage was 93.51%. Factory's trusted per-source/change metrics remain the
merge authority. No coverage threshold or safety gate changed.

Runtime sources are unchanged by this repair. Prior native binding invalidation
and separate live qualification authorization still apply. Publication uses a
verified signed commit pushed by the Factory App. Owner review must target the
final published head. Corrective work used two reviewed batches and remains
within the repository repair allowance.

## Final bounded branch-coverage batch

Factory line metrics passed at b1a0643: global 93.73%, changed 93.68%.
Changed branch coverage was 87.53%, below the unchanged 90% requirement.
Added public malformed diagnostic/auth tests, protected-storage path/architecture
and failed-rename cleanup tests, and native boundary failure/challenge/denial
cases that still require stopped worker state. Fixed fixture mock restoration.
Both independent reviews cleared the final batch with zero corrective findings.
Final full Windows synthetic suite: 199 tests, 198 passed, one macOS-only skip,
zero failures. Typecheck/formatting/whitespace passed. Hosted Factory branch
metrics must be confirmed after publication; no native acceptance was rerun.
The three-cycle repair allowance is now consumed; preserve any remaining
blocker rather than silently starting a fourth repair cycle.
