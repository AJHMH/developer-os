# Automatic Factory approval refresh — VERIFIED

Deployed main: `9bbc05175f00a0a2c59a9c8ab74ef2a45a0e0076`, PR #20 merged by `ajhmh-software-factory[bot]`. PR #18 also merged by the App. Required checks passed; post-merge Factory Adoption run 38597988197, CodeQL run 38597987354 and native CI run 38597987656 succeeded.

## Hosted automatic dispatch

Disposable PR #21 approved head `acd227ae92789adf5f207cb19dd7e54a01bce714`, owner review 5521191638. The owner submitted review before baseline jobs finished, so this probe demonstrates automatic rerun and current authority, not an initial missing-approval-to-success transition. Earlier probes retained missing-approval failures but do not establish complete automatic success.

Observer 38598177799 triggered refresh worker 38598199862 from trusted deployed main. The worker succeeded and recorded two requested original-job reruns: job 115969812953, then recreated sibling 115971024347, both within Factory run 38598029471. The original shared run finished at attempt 3, success, with `triggering_actor=github-actions[bot]`. Final jobs 115971666405 (human approval) and 115971661705 (trusted human approval) both succeeded. This evidence uses original jobs, with no replacement check verdict or manual rerun.

## Invalidation

A harmless signed App push moved the probe to `ced86b703401cea634764f578a54bd3324ddef2a`. GitHub dismissed review 5521191638. New-head original Factory run 38598904077 attempt 1 failed both approval jobs: 115972842899 and 115972842593. GitHub merge state was BLOCKED. Dismissal worker 38598925739 refused in its read-only resolver with requests=[]; it granted no authority and did not rerun jobs.

## Cleanup and local verification

PR #21 closed without merge; exact temporary remote branch deleted through the App. Failed probe #19 also closed without merge and its temporary remote branch deleted. Local main fast-forwarded to deployed main, preserving unrelated untracked files. The receipt and sanitized evidence are included in this documentation change.

Local suite: 280 tests, 278 passed, zero failures, two platform skips. Explicit system Python configured for native fixtures. Formatting passes. Independent Standards and Spec review: no actionable findings. No provider inference was run for this feature; existing approval/merge requirements and Factory policy pin remain enforced.

The temporary missing-job inventory is a regression-covered hypothesis for the earlier generic worker failure; the successful hosted rerun proves the final behavior, not the historical response shape.

Feature implementation and repair issues 01–03 are now complete as evidenced by this receipt; their issue checklists link to this final evidence.

## Retained evidence

- [Successful worker metadata](hosted-worker-result.json) and [dispatch log](hosted-refresh-success.log).
- [Original run attempt and triggering actor](hosted-original-run-result.json).
- [Final automatic approval job results](hosted-approval-results.json).
- [New-head stale-approval failures](hosted-invalidation-results.json).
- [Unmerged probe closure](hosted-probe-cleanup.json).
- [Successful refresh worker](https://github.com/AJHMH/developer-os/actions/runs/38598199862) and [original Factory run, attempt 3](https://github.com/AJHMH/developer-os/actions/runs/38598029471/attempts/3).
- [Invalidated-head Factory run](https://github.com/AJHMH/developer-os/actions/runs/38598904077) and [closed probe PR #21](https://github.com/AJHMH/developer-os/pull/21).
