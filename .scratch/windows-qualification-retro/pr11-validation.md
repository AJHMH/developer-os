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

## Owner-authorized Windows hosted repair cycle

On October 12 the owner extended the repair allowance by one cycle and approved
temporary repository-scoped Factory App workflow permission for diagnosis and
publication. Each installation token is revoked after publication. The initial
Windows run 38316713780 timed out at ten minutes; protected-storage initialization
also refused after the unchanged fifteen-second subprocess deadline.

Credential-free hosted probes established that stdin was received, but implicit
PowerShell module loading stalled. Explicit import of the OS Utility module made
JSON conversion pass, after which Security module autoload stalled at Get-Acl
(diagnostic job 115045704326). Matching the hosted Node version locally passed;
changing hosted stdin readers, pipe style or the minimal module search path alone
did not resolve the stall.

The repair explicitly imports Utility, Management and Security manifests from
the running OS PowerShell installation and disables implicit module loading.
It preserves the minimal environment, fixed executable and scripts, stdin-only
data, private ACL requirements, CurrentUser DPAPI, limits and redacted refusals.
Temporary diagnostic workflow/script changes are removed from the final tree.
The public host regression first refused with module autoload disabled, then
passed setup, create/read and replace/read with fixed synthetic account values.
Independent Standards and Spec reviews cleared the final net batch with zero
corrective findings. Local Windows validation: 200 tests, 199 passed, one macOS
ACL skip, zero failures; typechecking and formatting also passed. This uses the
one owner-approved additional repair cycle. Required hosted checks must pass on
the final published head before approval readiness can be claimed. Native
qualification and live inference were not rerun; production remains disabled.

## Owner-authorized protected-file creation repair

The owner granted one further repair cycle after the module fix exposed hosted
Windows storage refusals. GitHub verified the same-tree signed replacement
f54906e; its Linux, macOS, Factory and CodeQL checks passed, while Windows failed.
The credential-free ownership probe in run 38321285284, job 115049708209,
confirmed the initialized directory was current-user owned but its Node-created
file was Administrators owned. Both had no unexpected Allow entries. Only
booleans were logged, using fixed synthetic bytes and disposable storage.

New registration, DPAPI ciphertext and replacement files now receive the
current-user owner and private ACL atomically through FileStream CreateNew.
No retained owner or ACL is repaired or relaxed. Existing registration and
replacement collisions preserve their bytes; CurrentUser DPAPI and post-write
verification remain mandatory. The ACL refusal fixture changes only Access
rules, avoiding audit privilege requirements and implicit module autoload.
Temporary diagnostic workflow and script changes are removed from the final
tree. The full local Windows suite passed 199 of 200 tests, with one macOS-only
skip; the subsequently added collision regression and all seven store tests
passed separately. Typecheck, formatting and whitespace checks passed.
Independent review and final hosted results are recorded after completion.
No owner credential, native VM, inference or production qualification was run.

## Owner-authorized synthetic evidence fixture repair and replacement PR

Hosted validation at 5ccee94 passed protected storage and authentication setup,
Linux, macOS, coverage and CodeQL. Three Windows positive qualification tests
still refused synthetic evidence because elevated-host fixture objects had the
default Administrators owner. The owner authorized one further repair cycle.
Test-only setup now assigns current-user ownership to explicitly selected
disposable evidence objects, leaving access rules untouched. Missing markers,
hard links, drift, permissive ACL and denied admission tests remain intact.
Production ownership checks and all approval gates are unchanged.

Both independent review axes reported zero corrective findings. The final full
local Windows suite passed 200 of 201 tests, with one macOS-only skip and zero
failures; typecheck, formatting and whitespace checks passed. The owner requested
closing PR 11 and publishing the signed updates in a new Factory App PR.
Hosted checks on that replacement remain required before approval readiness.
No live credentials, native VM or inference were used; production stays disabled.
