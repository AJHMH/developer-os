# Plan: CLI delivery integration

Status: **proposed for the owner's approval.** The decisions are in
[ADR 0004](../../docs/adr/0004-cli-delivery-integration.md).
Date: 31 October 2026.

## What it delivers

One delivery driven from the CLI, from `start` to a validated candidate, with
production disabled. It addresses:

- Issue 04: "Integrate the general coding transport with the pinned dedicated
  VM", for the CLI;
- ticket 05: "Actual native planner", in the owner-written form ADR 0004
  chooses.

## Slices

Each slice is test-first, with no native, VM or credential use, and its own
PR through the bot publisher. None changes a guest program or pin.

1. **Owner criteria planner.** `ownerCriteriaPlanner(path, deliveryId)`
   implements `FeaturePlanner` from the private criteria file: scope, delivery
   id and request SHA-256 must match. `plan-feature` and `clarify-feature`
   take `--feature-criteria`. Tests cover a valid plan, `needs-info`, and
   refusals for another delivery, another request, a public or in-repository
   path, and malformed criteria.
2. **Owner-attested onboarding.** An attested inspector merges local
   repository hints with the record's facts. The report marks those facts
   `owner-attested` and records the record's SHA-256. Delivery commands that
   re-read the policy take `--owner-policy` and `--onboarding-attestation`.
   Tests cover readiness only with a matching policy and repository, and
   refusals for a stale, mismatched or incomplete attestation. Reports never
   call attested facts verified.
3. **CLI validation runtime.** `nativeValidationRuntime(machine, admission)`
   moves the authority derivation into `src/`. `validate-baseline` and
   `validate-candidate` take `--podman-machine`, `--validation-admission` and
   `--owner-policy`. Tests mirror PR 157: option rules, a clear refusal with
   no state written, and the runtime's pins and authority.
4. **Offline `code-feature`.** `code-feature` takes the coding, validation,
   policy, attestation and usage options. Tests drive the chain `start` →
   `plan-feature` → `validate-baseline` → `code-feature` through the
   controller with simulated transports. They show an offline turn reaching
   an admitted candidate and `DELIVERY_NOT_ENABLED`.
5. **Routed `code-feature`.** The credential-backed `GeneralSessionFactory`
   moves from `scripts/run-native-credentialed-qualification.mjs` into `src/`
   unchanged, and the script imports it. `code-feature` takes
   `--auth-directory` and `--auth-account`. Tests use a fake provider and
   vault, with no inference.
6. **Owner-run CLI acceptance.** A script runs one offline delivery through
   the real CLI on each host, from fresh `main`. Routed live turns follow ADR
   0002's budget and one-shot approval and remain the owner's.

## Owner inputs

- **Per delivery:** one criteria file.
- **Per repository and policy:** one onboarding attestation.
- **Per host:** the coding and validation admission records (they exist
  already) and, for routed turns, the auth directory and account.

## Out of scope

A model-based planner, a live onboarding inspector, publication, review and
merge from the CLI, and production enablement. Each needs its own decision.
