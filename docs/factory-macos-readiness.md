# Factory readiness on macOS

Inspected 10 October 2026 at consumer revision
`a03269b71b7aa333466d329a86b05461d5ca65ae`.

## Local setup

Node 24.15.0 and npm 11.13.0 are installed on this Mac. The pinned npm
dependencies are installed with lifecycle scripts disabled. `.nvmrc` selects
24.15.0 for developers using nvm. Run the normal README checks; loopback tests
need a host environment that permits local listening sockets.

Test fixtures now canonicalize temporary directories with `realpathSync`.
macOS aliases `/var` to `/private/var`; comparisons against controller-resolved
paths must use the same canonical identity. The crash-recovery subprocess now
receives fixture values as JSON arguments rather than interpolating them into
executable source. No application behavior or safety gate was relaxed.

## Verified Factory configuration

The lock and both reusable workflow calls pin Factory distribution 1.1.0 at
`2a294c1a65a95612f6963ea2c8ff382dd12fc9db`. GitHub's independent
`FACTORY_DISTRIBUTION_REVISION` variable matches. Native CI and full TypeScript
and Actions CodeQL ran successfully at the inspected consumer revision.

Factory governed default branch ruleset **24858786** is active, targets the
default branch and has no bypass actors. A fresh read confirmed its effective
main-branch rules: signed commits, linear history, deletion and force-push
prevention, current review with stale dismissal and last-push approval,
resolved review threads, and strict up-to-date required checks. The eight
Factory checks, native CI and both CodeQL jobs are required and bound to Actions
integration 15368. The Factory's trusted approval gate enforces the owner identity;
the native one-review rule alone does not restrict the reviewer to that owner.

The inspected merge commit is verified by GitHub. PR #5 has an actual
`aaron-howard` approval on head `8a08af48d8c629ea3d2842d8ae38388da56a39cf`.
These historical facts do not approve the local changes from this audit or
qualify this Mac's signing or worker execution.

## Remaining blockers

[Factory producer run 38079974546](https://github.com/AJHMH/developer-os/actions/runs/38079974546)
failed security and SAST gates. Downloaded original reports are retained under
`.scratch/factory-macos-readiness/evidence/`.

At the pinned Factory revision, both `schemas/security-evidence.schema.json`
and `schemas/sast-evidence.schema.json` restrict `profile` to `node-24`, while
this consumer emits `node-24-typescript-cli`. The security scanner evidence
reports clean secrets and dependencies, but schema validation rejects it.
A reviewed Factory correction and independently approved replacement pin are
required; editing reports or changing the consumer's declared profile is not
an acceptable repair.

SAST evidence also contains four medium `js/bad-code-sanitization` findings at
`tests/controls.test.mjs:366`. The local subprocess change removes the reported
source interpolation. A fresh exact-source hosted CodeQL run must establish
whether it resolves those findings; local tests cannot establish that.

No repository Actions secrets were listed at inspection.
`FACTORY_CERTIFICATION_READ_TOKEN` must be created directly in GitHub as an
expiring token scoped only to this repository with Administration, Checks,
Issues and Pull requests read. Do not copy a broad CLI token into this secret.

After reviewed fixes and owner approval, obtain a successful exact-source main
producer, assemble unchanged passing evidence and dispatch certification as
specified in `docs/factory-onboarding.md`. No successful certificate was
established by this audit. Local dependencies and governance are prepared;
full Factory certification and autonomous macOS feature delivery remain blocked.
