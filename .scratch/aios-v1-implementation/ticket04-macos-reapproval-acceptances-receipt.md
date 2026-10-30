# Issue 04: macOS re-approval and offline acceptances after PRs 139 and 143

30 October 2026. macOS 27.2.0 arm64, VM `aios-macos-noshare`. No inference,
no credentials, no usage spent, no code change. Every run was from clean,
freshly built `main` at `27b7db1` (`buildFresh: true`, `sourceDirty: false`),
and every report keeps `productionEnabled` and `qualified` false.

## Re-approval

PR 139 changed the coding guest program and PR 143 the validation guest
program, so each record's `policySha256` pin went stale. On 29 October both
admission acceptances stopped before any VM effect (outcome `blocked`) and
printed fresh pins; only `policySha256` differed in each:
- coding: `829e7e1e…` → `7b587bd9be1e001b9d7b2c920454cb63790adc82928aaa73de7cc78f2f64f16b`
  (blocked report `issue04-admission-acceptance-20261029-173515.json`);
- validation: `c213f918…` → `585cd02cc6a9eff07e8e4f1f16d96719b3f24f40f0f7f57b349a7c0d1927448f`
  (blocked report `issue04-validation-acceptance-20261029-173534.json`).

The owner wrote both records on 30 October (`approvedAt`
`2026-10-30T17:22:32.000Z`), mode 600, with the other pins unchanged: CLI
0.161.0 `0129f94f…`, code-mode host `64efe295…`, coding binding `aac1b6b5…`,
image `171e6526…`, validation binding `ac8967ce…`.

## Runs

All reports are under `~/.developer-os/`.

| Acceptance | Outcome | Report | SHA-256 |
|---|---|---|---|
| Coding admission | `observed-offline-admission-acceptance` | `issue04-admission-acceptance-20261030-122536.json` | `3b9dbdd2b453a36fc1c1ce830936d68399abae2864714dd9ba3f431026d31f63` |
| Validation admission | `observed-offline-validation-admission-acceptance` | `issue04-validation-acceptance-20261030-122656.json` | `0b470d968181f82c32edb9892e88821dcf59a0ec04be6c554c4ae6e188d193a3` |
| Session (lineages A and B) | `observed-offline-session-acceptance` | `issue04-session-acceptance-20261030-122743.json` | `3c13afc7b390167a873e776a0ef2b64c76f8ae106bffdadcd9dfc649cff4a866` |
| Usage canary | `observed-offline-usage-canary` | `issue04-usage-canary-20261030-122921.json` | `965f11cc0fba3dd8c14f1d98a2fbbce4b06950ae1723076dd66854dd70bd909d` |

- Coding admission: the controller turn ran through the real transport under
  the record, started an offline thread, and stopped the session; delivery
  stayed blocked on `DELIVERY_NOT_ENABLED`.
- Validation admission: all 5 stages passed, including the five isolation
  baseline checks on the pinned Alpine image. The image has no `npm`, so the
  D2b install path did not run natively.
- Session: all 24 stages passed, including both lineages, recovery,
  retirement, cleanup and the final exact stops of 9 sessions.
- Usage canary: all 10 stages passed, including refusal on unknown usage,
  the approval gate on low usage, exhaustion mid-turn, refusal to restart
  without approval, and a new lineage for a new decision.

## Not covered

- Windows: the same re-approval and runs need the owner on that host.
- The D2b dependency install natively: needs an owner-loaded, digest-pinned
  image with `npm` and an acceptance stage that exercises it.
- Slice 5 live credentialed runs, which spend usage.

Also corrected: the "Remaining" list in `docs/isolated-validation.md` still
showed dependency installs as open; it now names the outstanding native run.

Production remains disabled.
