# #269: native review acceptance on macOS

12 November 2026. macOS 27.3.0 arm64. The owner ran it from a freshly built
`main` at `f3ac9d5` (#301). The report records `buildFresh: true` but not its
source revision.

It wrote only to the disposable repository
`AJHMH/aios-publication-acceptance`: two signed branches, two App PRs and one
resolved conversation. It submitted no review: the owner commented, reacted
and approved in GitHub. It merged nothing and used no model.

This proves the native review adapter
([review and owner approval](../../docs/review-owner-approval.md#native-adapter-269))
against real GitHub, read through the owner's `gh` login:
- the change gate (ADR 0005) on a real diff;
- the owner as sole eligible approver;
- the owner's 👍 assessment;
- conditional resolution;
- exact-head approval.

## Runs

1. **`issue10-review-acceptance-20261112-152840.json`** (`4ca2557`).
   Blocked at `observe-ungated` on PR 4: "PR 4's review is incomplete". The
   conversation query could reach a million nodes, and GitHub refuses any
   query over 500,000 (`MAX_NODE_LIMIT_EXCEEDED`). Fixed in #301.
2. **`issue10-review-acceptance-20261112-160619.json`** (`f3ac9d5`).
   Blocked at `owner-review`, out of time, on PRs 5 and 6. The owner's comment
   on PR 6 was in the Conversation tab, not on a line, so it wasn't a review
   conversation. The script printed nothing while it waited, so the owner had
   no sign of that. The script now prints each change it sees, and says that
   a Conversation-tab comment doesn't count.
3. **`issue10-review-acceptance-20261112-165733.json`** (`f3ac9d5`):
   `observed-native-review-acceptance`, SHA-256
   `6931c61f8144d2540d05cb1b5e0750f7a8bac2108cf8823829dff10588ce1f40`.

Before run 3, the owner also approved PRs 1 to 6 while working out the steps.
Those approvals were outside every run's observation and are harmless.

## Passing run

All seven stages passed:

- **`publish-ungated` (21 s), `observe-ungated` (5 s):**
  - [AJHMH/aios-publication-acceptance#7](https://github.com/AJHMH/aios-publication-acceptance/pull/7),
    head `43794a3d…`, adds one file under `acceptance/`;
  - the change gate classified it ungated;
  - it is authorized as `ungated` for exactly that head, with no review;
  - the eligible approvers are just the owner, with admin, and the owner
    pushed the head.
- **`publish-gated` (20 s), `observe-gated` (4 s):**
  - [AJHMH/aios-publication-acceptance#8](https://github.com/AJHMH/aios-publication-acceptance/pull/8),
    head `a43c4535…`, also adds `.github/aios-review-acceptance.txt`;
  - it is gated ("touches controller authority"), with no authorization.
- **`owner-review` (10 min, the owner's time):**
  - the owner commented on line 1 of the `.github/` file, replied in the same
    conversation, reacted 👍 to the first comment and approved;
  - the conversation `PRRT_kwDOVrSzcs623wwm` was assessed `straightforward`,
    with the finding ".github/aios-review-acceptance.txt:1: Add a closing
    line / Will add a line";
  - the approval, review `5883385824` on the head, did not count while the
    conversation was open.
- **`resolve` (2 s):**
  - the adapter re-read the head and the conversation, recorded operation
    `f0609c43…`, and resolved it through GraphQL;
  - GitHub answered resolved.
- **`observe-approved` (5 s):**
  - the receipt is `accepted`, and the conversation is observed resolved;
  - the owner's approval now authorizes exactly `a43c4535…`.

## Not covered

- **The CLI commands on a delivery.** `monitor-review`, `repair-review` and
  `resolve-review-thread` install this adapter from the owner policy, but no
  real delivery has reached them. That needs the owner's production admission
  record (ticket 04).
- **A review repair, natively.** No conversation went through
  `repair-review`'s Claude Code repair and republication.
- **Disputed and conflicting conversations, natively.** No 👎 or other
  person's conversation was observed. Tests cover them.
- **New commits invalidating approval, natively.** No head moved after the
  approval. Tests cover it.
- **Interrupted resolutions, natively.** Tests cover the two-minute absence
  rule.

PRs 1 to 8 and their branches are left open in the disposable repository.
They are harmless.
