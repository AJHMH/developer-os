# Operator tool validation

The final focused suite passes 21 tests with one expected Windows-only skip on
macOS. It covers real Git staging/adoption and linked-worktree refusals, private
state limits, cycle/time exhaustion, interrupted operations, exact proposal
approval, wrong identities/signatures, minimal App permissions and uncertain remote
writes. Plans remain inert data and cannot authorize another scope. Type checking,
formatting and both review axes pass. Existing tests and production source are
unchanged; the new test filename sorts last to preserve existing shard assignment.

The initial unsupervised local full suite was stopped manually at 105 seconds and
is incomplete, not a passing or deadline result. The subsequent trusted Factory
execute() invocation enforced the unchanged 120-second limit and timed out with
successful process-group termination. An isolated unchanged-main comparison at
e68fa3d, using the same Node/runtime/dependencies and command, also timed out at
120 seconds. Both failures are retained in validation.json. Final focused tests
were repeated after the last operator-only edits; no passing full-suite claim is
made. These comparisons do not diagnose a cause or authorize a timeout increase.

Hosted exact-head validation and independent human review remain required. Main's
previous Windows storage initialization and competing-CLI ownership failures and
unexplained Linux timeout remain separate unresolved baseline observations. This
proposal provides no flake exception, production qualification or merge authority.

Live App publication is exercised through scripts/publish-operator-proposal.mjs
only after review and exact staged-proposal inspection. Its external private
proposal/receipt is the authoritative publication evidence, and the resulting PR
is attached to the current chat. See docs/operator-tools.md for trust/platform
limits; source credentials and private state are never committed.
