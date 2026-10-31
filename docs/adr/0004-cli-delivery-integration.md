# CLI delivery integration

Date: 2026-10-31
Status: proposed

## Context

The controller can run one delivery from request to a validated candidate.
Tests and the owner-run native acceptances inject everything it needs. The
CLI injects almost none of it, so `plan-feature` and `code-feature` always
refuse there:

- **Onboarding never becomes ready.** The CLI's `inspectLocalRepository`
  reads local Git hints only. App access, approvers, protections, signing,
  publication and the Factory commit stay unknown, so `onboarding.ready` is
  false (`src/onboarding.ts`). `codeFeature` requires it.
- **No feature planner.** `FeaturePlanner` (`src/feature-candidate.ts`) has
  only fixed stubs in scripts and tests. The spec says AIOS derives the
  criteria but no spec, ADR or plan chooses how. Ticket 05 leaves the native
  planner open.
- **No validation runtime.** `PinnedValidationRuntime` and
  `ownerValidationAdmission` exist, but only the acceptances build them.
  `validate-baseline` and `validate-candidate` accept no options.
- **No usage reader or routed session for coding.** Every coding turn
  checks usage, even offline, so `code-feature` needs `--codex-executable`.
  The credential-backed `GeneralSessionFactory` exists only in
  `scripts/run-native-credentialed-qualification.mjs`.
- **Delivery commands take no `--owner-policy`.** Onboarding and the
  validation contract re-read the policy at each step.

PR 157 started this integration: `pause`, `cancel` and `recover` take
`--coding-admission` and install the owner-admitted native coding runtime.

## Decision

The owner decided the following on 31 October 2026.

1. **Owner criteria file (v1 planner).** `plan-feature` and
   `clarify-feature` take `--feature-criteria <file>`. It is a private,
   owner-written file outside every repository, with the same path and
   permission checks as the owner admission records. It holds scope
   `aios-feature-criteria-v1`, the delivery id, the SHA-256 of the exact
   request (and clarifications) it answers, and `criteria`, `verification`,
   `ambiguity` and optional `requires`. `featurePlan()` validates it
   unchanged. A file for another delivery or request is refused. This
   departs from the spec's "AIOS derives the criteria": the owner writes
   them for now. A model-based planner can replace it later behind the same
   `FeaturePlanner` interface and needs its own ADR, because it spends
   inference.
2. **Owner-attested onboarding.** Commands that take `--owner-policy` also
   take `--onboarding-attestation <file>`. It is a private, owner-written
   record outside every repository, with scope
   `aios-onboarding-attestation-v1`, the policy SHA-256 and repository
   identity it attests, and one entry per onboarding requirement the CLI
   cannot observe locally (factory, app, approver, protections, signing,
   publication, validation).
   - The repository identity is still observed locally, as today, and must
     agree.
   - Attested facts are recorded with `source: "owner-attested"` and the
     record's SHA-256, never as live verification. The onboarding report
     and every qualification report say so.
   - Attested readiness admits controlled delivery only. It never satisfies
     production enablement, which needs live verification.
3. **Validation from the CLI.** `validate-baseline`, `validate-candidate` and
   `code-feature` take `--podman-machine` and `--validation-admission <file>`.
   The CLI then installs the owner-admitted native validation runtime,
   mirroring `nativeCodingRuntime`: the record's pins, the live transport and
   the authority the acceptances already derive. Dependency installs use the
   prepared npm cache only, as today.
4. **Coding from the CLI.** `code-feature` takes `--coding-admission`,
   `--codex-executable` and `--coding-minutes`. Without a qualified
   mediation decision for the delivery, its turn is offline. An offline
   turn has no model access and proves only the delivery mechanics.
5. **Routed coding from the CLI.** `code-feature` takes `--auth-directory`
   and `--auth-account`. The CLI then builds the credential-backed
   `GeneralSessionFactory` in `src/`, moved from the credentialed script
   unchanged. A routed turn still needs a qualified mediation decision from
   `qualify`, fresh usage authority and every ADR 0002 control. Live turns
   stay under the owner's fresh, one-shot approval.
6. **Production stays disabled.** `DELIVERY_NOT_ENABLED` and
   `productionEnabled: false` stay. The CLI can reach a validated candidate
   but not publication, review or merge. Production enablement remains a
   separate decision.
7. **No guest change.** None of this changes a guest program or pin.

## Consequences

- An owner can drive one delivery from the CLI: `start` → `plan-feature` →
  `validate-baseline` → `code-feature` → `validate-candidate`. Each step
  names its owner-written inputs explicitly. Nothing is read from the
  repository or from worker output.
- The criteria file and the attestation are owner trust inputs. They are
  only as accurate as the owner writes them. Reports label them as such.
- Ticket 05's "native planner" item is met only in this owner-written form.
  The model-based planner and the live onboarding inspector remain open.
- Each step is implemented test-first, with no native, VM or credential use.
  The owner then runs one CLI delivery natively on each host. See
  `.scratch/aios-v1-implementation/plan-cli-delivery-integration.md`.
