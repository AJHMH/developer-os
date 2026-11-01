## Agent skills

### Merge handoff

Run required validation before merging. After a clean, validated merge, reuse the
passing results; do not rerun the repo's validation suite merely because the merge
completed. Fetch and fast-forward local `main`, delete task branches confirmed
merged and no longer needed, then create a `codex/` branch from synchronized
`main` when the next task is known. Preserve unrelated changes and branches. Run
additional validation only when source changes, merge conflict resolution, failed
checks, or new evidence invalidate the passing results.

When `main` moves from a worktree, `~/Repos/developer-os` keeps `main` checked
out and goes stale: if its files still equal the old `main` and it has nothing
untracked, reset it to the new `main`.

### Issue tracker

Issues and specs are tracked as local Markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five triage roles as local issue status values. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Operator tools

For investigation accounting or App-authored publication, see `docs/operator-tools.md`.

### Owner hosts

For commands the owner runs natively, or a guest program change, see `docs/owner-hosts.md`.
