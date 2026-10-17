# 12: Cross-cutting locality and navigation

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11

## Scope

Consolidate path containment with explicit inclusive/strict semantics; name timeouts by domain meaning; narrow version invalidation only where evidence equivalence is demonstrable; remove runtime circular imports; refresh stale graft navigation.

Affected files: controller.ts, subscription-auth.ts, auth-status.ts, codex-mediation.ts, subscription-decision.ts, onboarding.ts, npm-artifact.ts, graft/.

## Completion criteria

Containment tests cover root/sibling/traversal/platform semantics; safety pin drift still refuses; no new runtime cycles; navigation matches final source.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026: Shared absolute inclusive containment has native/Windows tests; concept-specific time constants replace unrelated numeric literals. Version dependencies target lifecycle/contract modules, controls construction has no runtime cycle, and CI rebuilds/checks ignored Graft navigation. Integrated validation is recorded in the parent spec.

17 October 2026 review: Online routing no longer hashes the whole controller.
Host controls deliberately retain that conservative dependency: their integration
exercise observes controller phase/ownership semantics as well as the extracted
lifecycle. Removing it would reuse evidence after a relevant guard changes.
