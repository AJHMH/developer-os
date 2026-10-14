# Isolated baseline and candidate validation

Ticket 06 adds controlled validation through DeliveryController.validateBaseline,
validateCandidate and stopValidation. Plan criteria first, validate unchanged clean
main, then code and validate the admitted candidate. The CLI exposes
validate-baseline and validate-candidate, but refuses without a trusted integration.
No native executor is installed and production delivery remains disabled.

The external, pinned onboarding policy supplies validationContract version 1:
environment, checks and mutablePaths. Environment declares image and network-policy
SHA-256 measurements, HTTPS registries, cache assumptions, synthetic browser/database
availability. Each check declares its id, kind, local/pr/main scope, stages, argv,
trusted publisher and bounded timeout. Format, lint, type, coverage and build are
required for both local stages; candidate acceptance is required. Feature browser
or database requirements also require declared synthetic infrastructure and E2E.
PR/main declarations are retained; later delivery slices must observe hosted results.

mutablePaths is an exact owner-approved application-file allowlist (maximum 256
paths; no directory globs). Every other file must match validated main, including
presence, content and executable mode. New files outside the list are refused.
The owner must exclude the complete validation implementation, test, configuration,
threshold, dependency and script closure from this list. Changing that closure
requires owner policy review and a new delivery/baseline. This conservative slice
also blocks dependency updates unless the owner explicitly revises the contract.

The trusted ValidationRuntime receives inert file bytes and argv. It must run
dependency lifecycle hooks, checks and disposable fixtures only inside the declared
isolated environment, honor dispatch fences and timeouts, and stop all descendants
before measuring the final tree. No repository scripts execute on the controller
host. Controlled tests exercise this interface; they do not qualify a native runtime.

Attempts persist operation/fence, source revision, exact tree, policy, contract,
criteria, runtime binding and environment hashes plus projected results/artifact
hashes. Missing or untrusted evidence cannot pass. Explicit owner exceptions may
cover incomplete statuses, never failure or timeout. One diagnostic rerun per
unchanged stage/tree is allowed; a later pass remains flaky unless the original
explicit failure has an owner flake policy. All attempts remain in the ledger.

Pause/cancel fence dispatch and reconcile shutdown. Uncertain descendants block
overlap, resume and release until recovery with the same binding. Formatting or
other output changes invalidate the tested tree. Policy, source, environment and
candidate are rechecked after shutdown; stale evidence cannot mark the candidate
passed. A passing local candidate still requires hosted checks and later delivery
gates before signing, publishing or merging.

Native qualification remains required on supported hosts: measured runtime/image,
real dependency and script isolation, bounded process-tree shutdown, registry/cache
enforcement, browser/database disposal, formatting reconciliation, pinned CLI
compatibility, and real pilot baseline/acceptance evidence. No provider requests or
native worker execution are authorized by this controlled test receipt.
