# Windows post-merge storage fixture diagnosis

Main commit de9664260552c381e1631ce45389f08cd6847ef7; CI run 38604629647 attempt 1. Two tests failed with the generic authentication-setup refusal at about 15.4 seconds: auth-host Darwin adapter fixture and auth-setup registration fixture. Other tests passed. The native Windows storage helper uses a fixed 15-second PowerShell startup deadline. Timings support a timeout hypothesis but the sanitized error does not identify the underlying child status.

Ranked hypotheses: competing test-file processes slow cold PowerShell startup; intermittent runner delay; deterministic storage/ACL refusal. The original unchanged `npm test` on Windows is the captured reproducer. Attempt 2, requested by owner aaron-howard, is a differential repeat on identical source. Attempt 2 passed all three OS jobs on identical source; no repair is needed for this occurrence. This supports intermittent runner/startup delay, without proving the exact cause. The unpublished Windows-only serial invocation was discarded; runtime deadlines and CI scheduling are unchanged.

Validation evidence under .scratch/aios-v1-implementation remains unchanged.

## Evidence and completion

- [Failed attempt: two storage-fixture refusals](postmerge-failure.log).
- [Successful unchanged-source rerun](rerun-test-summary.log): 280 Windows tests, 277 passed, zero failed, three platform skips. Both previously failing fixtures passed in about 8.3–8.5 seconds.
- [Hosted CI run, successful attempt 2](https://github.com/AJHMH/developer-os/actions/runs/38604629647/attempts/2). Linux and macOS jobs also succeeded. Factory Adoption run 38604630328 and CodeQL run 38604629503 succeeded on the same main commit.

The exact root cause remains unconfirmed: the first-attempt timings align with the 15-second storage-helper deadline, but the generic refusal did not report child timeout metadata. The unchanged-source success supports an intermittent runner/startup issue; it does not establish concurrency as the cause. No runtime or CI configuration repair was applied.

After all main CI passed, the fully merged `codex/macos-diagnostic-cleanup-record` branch and empty unpublished experiment branch were removed. All 169 preserved validation evidence files matched their inventory SHA-256 hashes. Only these diagnosis/evidence records are added by this PR.
