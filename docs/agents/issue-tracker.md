# Issue tracker: GitHub Issues

Issues and specs for this repo live in GitHub Issues on `AJHMH/developer-os`.
Use the `gh` CLI for every operation. The `.scratch/` directories hold history
from before 7 November 2026. Read them for evidence, but don't create new
issues or specs there. Receipts and evidence files can still go under
`.scratch/`; only issue tracking moved.

## Conventions

- **Spec**: one issue per feature, labelled `spec`, titled `Spec: <feature>`.
  The body is the spec.
- **Implementation tickets**: one issue per ticket, each added as a sub-issue
  of its spec. Never put several tickets in one combined issue. Order them by
  `NN.` at the start of the title (`01. Pin the Claude Code CLI`).
- **Triage state**: exactly one triage label per issue (see `triage-labels.md`).
- **Type**: a `type:<research|prototype|grilling|task>` label.
- **Blocking**: a `Blocked by: #N, #N` line at the top of the body. Also set
  GitHub's "blocked by" relationship where `gh` supports it.
- **Comments and conversation history**: issue comments
  (`gh issue comment <n> --body-file …`).
- Use `--body-file`, not inline `--body`, for anything longer than one line.

## When a skill says "publish to the issue tracker"

```bash
ISSUE_TITLE="01. Pin the Claude Code CLI"
ISSUE_BODY_FILE="$PWD/issue-body.md"
test -s "$ISSUE_BODY_FILE" && gh issue create --repo AJHMH/developer-os --title "$ISSUE_TITLE" --label needs-triage --body-file "$ISSUE_BODY_FILE"
```

To attach a ticket to its spec, add it as a sub-issue:

```bash
SPEC_NUMBER=214
TICKET_NUMBER=216
TICKET_ID=$(gh api "repos/AJHMH/developer-os/issues/$TICKET_NUMBER" --jq .id)
test -n "$TICKET_ID" && gh api -X POST "repos/AJHMH/developer-os/issues/$SPEC_NUMBER/sub_issues" -F sub_issue_id="$TICKET_ID"
```

The sub-issue API takes the ticket's numeric `id`, not its issue number.

## When a skill says "fetch the relevant ticket"

```bash
ISSUE_NUMBER=216
gh issue view "$ISSUE_NUMBER" --repo AJHMH/developer-os --comments
```

The user normally passes the issue number or URL.

## Wayfinding operations

Used by `/wayfinder`. The **map** is an issue, and each **child** ticket is a sub-issue of it.

- **Map**: an issue labelled `map`, with the Notes, Decisions-so-far and Fog in its body.
- **Child ticket**: a sub-issue of the map, with the question in its body and a `type:` label.
- **Blocking**: the `Blocked by: #N` line. A ticket is unblocked when every issue it lists is closed as completed.
- **Frontier**: open, unblocked sub-issues of the map that have no `claimed` label. The lowest `NN.` wins.
- **Claim**: add the `claimed` label and assign yourself, before any work.
- **Resolve**: post the answer as a comment headed `## Answer`, close the issue as completed, then add a context pointer (the gist plus a link to the comment) to the map's Decisions-so-far.
