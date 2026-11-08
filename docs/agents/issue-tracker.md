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
gh issue create --repo AJHMH/developer-os --title "<title>" --label needs-triage --body-file <file>
```

To attach a ticket to its spec, add it as a sub-issue:

```bash
gh api -X POST repos/AJHMH/developer-os/issues/<spec-number>/sub_issues -F sub_issue_id=<ticket-issue-id>
```

The sub-issue API takes the issue's numeric `id` from `gh api repos/AJHMH/developer-os/issues/<n> --jq .id`. That is not its number.

## When a skill says "fetch the relevant ticket"

```bash
gh issue view <n> --repo AJHMH/developer-os --comments
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
