# GitHub Actions hardening review

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 0 |

Checked new review observer and privileged refresh worker plus the consumer run
binding: triggers, script injection, candidate execution, immutable action/policy
pins, token scopes, checkout credentials, output validation and data-only API
handling. Only trusted base code runs with Actions write. No artifacts, caches,
owner/App PEM or candidate dependencies enter that job. The owner caller and
repository permission are revalidated before every allowlisted rerun.

Independent Standards review found no hard breaches or actionable heuristics.
Spec review found default concurrency could replace an earlier pending refresh.
Resolved with `queue: max` plus explicit 100-pending overflow/manual-recovery
limits. Refer to the official GitHub concurrency contract in the runbook.

This review does not prove hosted event delivery. Bootstrap and hosted evidence
remain required. Changes were implemented under the user's request and are
presented for review in the Factory App PR.
