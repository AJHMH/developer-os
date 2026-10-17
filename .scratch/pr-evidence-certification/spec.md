# Reuse pre-merge checks after merging

Status: in progress — Factory merged; consumer owner review required

Factory PR: https://github.com/AJHMH/software-factory/pull/74
Merged dependency: `26c641d207c0754eeb2037679d944cebe62977ff`

Developer OS removes main-push triggers from native CI, CodeQL and Factory
adoption. PR checks remain required. Factory certification consumes the successful
PR producer run, original package and reviewed-head evidence; verifies the merged
Git tree and first-parent baseline; and refreshes live check/review/governance
observations without rerunning consumer code. The certificate preserves tested
`revision` and records `mergedRevision` separately.

## Rollout

1. Completed: Factory PR #74 received owner review and merged after checks.
2. Select the approved immutable Factory revision in the consumer lock, both
   reusable calls, approval-refresh tool and GitHub variable
   `FACTORY_DISTRIBUTION_REVISION`. The consumer patch and approved variable now
   select the merged revision recorded above.
3. Run consumer PR checks, obtain owner GitHub review and merge the consumer change.
4. After merging, sync main and clean up eligible task branches. No main-push
   validation workflow is configured.

Certification dispatch remains optional and explicit: use the approved consumer PR
head as `source_revision`, its successful adoption run as `producer_run_id`, the
merged PR number, and the six original reports as `evidence_bundle`. Changed merge
content or baseline requires fresh PR validation rather than relabeling evidence.

Developer OS production controller main-verification contracts are separate from
this repository contributor/CI workflow and remain unchanged.
