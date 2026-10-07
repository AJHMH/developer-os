# 08: Publish signed code and create an App-authored PR

**What to build:** A validated candidate is signed through the trusted configured Git identity, published to the onboarded repository and proposed as a Software Factory App-authored PR, preserving independent owner review eligibility.

**Blocked by:** 07: [Repair validation findings within persisted allowances](07-bounded-validation-repair.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 8, 24, 29. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] The committed tree matches admitted validated output and its evidence; trusted Git configuration prevents candidate hooks or scripts executing during signing/publication.
- [ ] Local signing and GitHub verified-signature evidence are checked; unavailable signing or repository authority blocks instead of publishing unsigned code.
- [ ] Git/GitHub identity performs the signed push; App installation credentials author the PR and retain the approved scope. The PEM is never used as a commit-signing key.
- [ ] A trusted cross-platform App adapter works without assuming a Windows helper/key path on macOS; credentials remain outside workers and reports.
- [ ] Persist operation intent before push/PR dispatch and outcome afterward; reconcile an existing branch/PR after uncertain acceptance rather than blindly duplicate it.
- [ ] No identity submits human APPROVED reviews; the expected App author and sole approver remain verifiable.
- [ ] Public fixture/temporary-repository tests cover partial failures, permission denial, wrong PR author, signatures and crash windows. Live pilot writes stay disabled until host and repository readiness pass.

