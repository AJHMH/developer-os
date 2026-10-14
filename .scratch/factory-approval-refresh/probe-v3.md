# Disposable automatic approval refresh probe

Tests the job-transition repair merged in PR #20.
Approval only after both original approval jobs fail; no manual rerun or merge.
The agent will invalidate and close this probe after verification.

New head deliberately invalidates the earlier human approval.
