# 11: Merge only the validated and owner-approved head

**What to build:** At the merge boundary the controller rechecks revisions, protection, reviews, conversations and trusted checks, then conditionally merges only the authorized candidate or reports a preserved blocker.

**Blocked by:** 10: [Address review findings and wait for owner approval](10-review-owner-approval.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 27, 28, 38. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] All required current-head approval/check/conversation gates and effective protections are verified immediately before dispatch; no bypass or manufactured evidence path exists.
- [ ] Merge is conditioned on the expected validated/approved PR head; head races cannot cause a different candidate to land.
- [ ] If main advances, refresh branch/applicable checks within remaining repair allowance; new PR commits require renewed owner approval.
- [ ] Policy/permission revocation, unsupported conditional behavior or budget exhaustion blocks merge with evidence.
- [ ] Persist intent and outcome; crash after remote merge acceptance reconciles the existing PR/main result rather than blindly merging again.
- [ ] Public tests cover head/base races, approval withdrawal, check changes, exact-head effect conditions and before/after-acceptance crashes.

