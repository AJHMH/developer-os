# Ticket 25 macOS worker validation — completed 14 October 2026

Status: VERIFIED. The public Mac assertion passes all nine live checks with
`outcome: qualified`, no blockers and `productionEnabled: false`.
Native evidence was captured for the implementation committed as
`beda43ef73caec62fcc045baaf3abef9e0df99a7`, based on PR 13 merge
`02c11ac49be5ea41be2ee9f6d1b8f36b7723c810`. The source hashes identify that
validated snapshot; subsequent PR review repairs are described below.
Windows receipts were not inherited.

## Final results

- Darwin arm64, explicit rootless AppleHV, Podman engine 6.1.3; dedicated VM
  configuration: 2 CPUs, 3 GiB memory, 20 GiB disk. Fresh source/VM policy:
  `/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-memory-3072-20261014.json`.
- All nine checks passed: host binding, offline transfer, adversarial isolation,
  online policy, authentication, usage gate, fencing/recovery, synthetic task
  and isolated validation. [Final public report](macos/ticket25-final-qualified-report.json).
- Owner-approved real inference `71c3b80f-9874-4c01-b86c-ef7bc9205091`
  completed through actual Codex and host-only subscription gateway. One fixed
  provider request; explicit crash/resume used zero additional inference
  requests. The gateway was revoked and the approval durably consumed.
- Separately approved VM-local online run `29df18b4-761a-4619-a3eb-f80f78ae51c8`
  passed model/dependency/bypass enforcement and its one-run unknown-usage gate.
  The fixed HTML task passed negative script and loopback HTTP validation inside
  isolation, followed by verified shutdown and safe collection.
- Final assertion verified 46 retained worker sessions and 11 online runs are
  stopped. Independent rootless and rootful running-container censuses are empty.
  The dedicated VM was then stopped and the temporary keep-awake assertion released.
- Host suite: 225 tests, 223 passed, zero failed, two Windows-only skips. Build,
  typecheck, formatting and diff checks passed. Both review axes found zero
  outstanding issues across the implementation and focused repairs.

## Scope and limits

This qualifies the fixed synthetic Mac worker slice. Production delivery stays
disabled; ticket 16 remains the later complete-controller/pilot qualification.
The real inference approval grants no further authority. Credentials stay in
host Keychain and trusted host memory; no refresh or paid fallback was used.
An intermediate credential-free Codex resume hit the unchanged 32-task ceiling
and was safely refused; that evidence is retained. Qualification does not claim
that every startup will fit the process budget or exhaustive escape resistance.

Repairs include bounded batched denial probes, fail-closed engine queries,
stable persistent descendant fixtures, host sleep prevention for explicit native
acceptance, sufficient measured VM capacity, and Mac-specific task scope checks.
Relay, persistence and gateway scheduling repairs have regression coverage.
Historical refusals were not converted into passing evidence. The [historical continuation log](macos/ticket25-local-validation-history.md)
and [selected historical evidence](macos/retained-evidence-20261014.md) are
retained separately from the final qualification receipts.

## Retained evidence

- [Source hashes](macos/ticket25-source-hashes.json), [review](macos/ticket25-code-review.md), and [host test output](macos/ticket25-task-scope-full-tests.log).
- [Real inference receipt](ticket25-macos-gateway-inference-observation.json) and [synthetic online receipt](ticket25-macos-online-observation.json).
- [Controls](ticket25-macos-controls-observation.json), [transfer](ticket25-macos-current-roundtrip.json), [fencing](ticket25-macos-current-fencing.json), and [isolation](ticket25-macos-current-isolation.json).
- [Task receipt](ticket25-macos-synthetic-task-observation.json) and [public capability receipt](ticket25-macos-public-capability-observation.json).
- [Rootless census](macos/ticket25-final-rootless-census.json) and [rootful census](macos/ticket25-final-rootful-census.json).
- [Failing Mac task scope regression](macos/ticket25-macos-task-scope-red.log) and [passing regression](macos/ticket25-macos-task-scope-green.log).
- [Failing descendant fixture](macos/ticket25-steady-descendants-red.log) and [passing fixture](macos/ticket25-steady-descendants-green.log).

The `ticket25-macos-*.mjs` acceptance scripts are explicit operator fixtures for
this host and policy; they are not automatic CI jobs. A new provider run requires
a fresh exact-run approval. The final public assertion also checked the retained
host ledger: all 46 sessions and 11 online runs were stopped. That full ledger is
retained locally rather than published.

## PR 14 review and CI follow-up

The initial hosted CI run exposed Windows pipe/shell portability issues and a
Mac fixture startup stall from HTTPServer's implicit loopback hostname lookup.
The fixed-address server now binds without DNS; the socket regression rejects
hostname lookups. The expiry test now drains events with
a portable reader, deliberately delays child startup by 3.2 seconds, and retains
the original lease-expiry assertions. Two tests that execute Linux guest code
with POSIX pipes/shell directly on the host run on macOS and Linux. CLI admission
coverage now exercises Mac controls, task and usage aliases. Source hashes use
explicit `path`/`sha256` fields to avoid a generic API-key false positive.

Review repairs preserve the intended Mac report target when infrastructure is
unavailable, including requalification after restart. The intended target grants
no admission. Supplemental controls use 30-second guest and 90-second management
deadlines on Mac, retaining Windows' 10/30-second bounds. Tests execute the actual
guest timeout function and verify both management deadlines.

These follow-ups were verified by host tests; hosted CI remains a merge gate. the live receipts above are
historical evidence for the identified validated snapshot. Source-bound control
receipts must be refreshed before claiming qualification of a later revision.
No further provider request or production enablement is authorized by these
changes.
