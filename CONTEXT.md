# Developer AIOS

## Implementation scope

This glossary defines the target delivery domain. The implementation currently reaches controlled synchronization, eligible cleanup and completion; native delivery integrations and complete-platform/pilot qualification remain unfinished. Independent fixed Windows/Mac worker qualification does not enable production. See [current implementation status](docs/implementation-status.md), and [architecture module decisions](docs/adr/0001-architecture-module-boundaries.md).


A developer agent system that carries delegated feature work through validation, pull request review, merge, synchronization, and branch cleanup.

## Language

**Feature delivery**:
The delegated journey from a requested feature to validated code merged into the main branch, with local and remote main synchronized and branch cleanup completed.
_Avoid_: Code generation, implementation-only task

**Validation**:
The lint, formatting, test, and applicable local or GitHub checks used to assess completed feature code.
_Avoid_: Tests alone

**Branch cleanup**:
The removal of eligible local and remote non-main branches whose current work is proven merged into main, including unrelated merged branches. Protected, replay-retained and active-worktree branches are preserved; unmerged work requires an explicit human deletion decision.
_Avoid_: Cache cleanup

**Retained branch**:
A branch intentionally preserved by protection, replay requirements, worktree use or unmerged work. Documented retention is expected and is distinct from a failed eligible deletion.
_Avoid_: Cleanup failure

**Main synchronization**:
The verified alignment of clean local main with remote main at a recorded revision, without discarding local work or rewriting history.
_Avoid_: Hard reset

**Merge approval**:
The owner's GitHub APPROVED review on the pull request's current head, authorizing agent merge once all required gates pass. A subsequent commit requires renewed approval; the agent never supplies the human review.
_Avoid_: Automatic merge authorization

**Delivery blocker**:
An unresolved validation or review issue that prevents feature delivery after the permitted retry or time budget is exhausted, reported to the owner with evidence.
_Avoid_: Silent failure

**Feature request**:
The written feature description handed to the local AIOS CLI together with a repository path, optionally referencing an existing issue.
_Avoid_: Unscoped instruction

**Repair budget**:
The allowance for correcting validation failures and review findings: at most three repair cycles or 60 active repair minutes, whichever is exhausted first. Initial implementation, CI/approval waits, pauses and downtime are excluded; usage survives restarts.
_Avoid_: Unlimited retry loop

**Repair cycle**:
An attempt to fix a batch of validation or review findings followed by relevant revalidation. Initial implementation is not a repair cycle, and new comments do not reset the allowance.
_Avoid_: Individual tool call

**Delivery completion**:
The state reached after approved code is merged, configured main-branch checks pass, local and remote main are synchronized without discarding local work, and eligible branch cleanup is finished.
_Avoid_: PR opened, merge alone

**Onboarded repository**:
A personal repository whose identity, Factory authority, App access, signing, validation and approval protections have been verified for feature delivery. Missing prerequisites prevent delivery and produce an onboarding checklist.
_Avoid_: Any accessible repository

**Pilot delivery**:
An observed small feature delivery that demonstrates the complete workflow in the selected profile-page repository, including signed code, App PR authorship, owner review, merge, validation, synchronization and eligible cleanup.
_Avoid_: Configuration inspection alone

**Feature acceptance criteria**:
Observable outcomes that define whether a requested feature is delivered, paired with relevant verification before coding starts.
_Avoid_: Green checks alone

**Validation evidence**:
Recorded outcomes of the declared checks and feature verification for a specific code revision, with enough provenance to identify what was tested and by whom.
_Avoid_: Latest green badge

**Baseline failure**:
A validation failure present on unchanged main before feature work, which blocks delivery when it prevents the required verification. Unrelated repair requires the owner to expand scope.
_Avoid_: Feature regression

**Paused delivery**:
A delivery whose progress and evidence are retained while new work is stopped, ready for an explicit resumption.
_Avoid_: Cancelled delivery

**Cancelled delivery**:
A delivery that stops scheduling new actions while preserving existing work and evidence. Cancellation does not itself close a PR, delete branches or undo a dispatched action.
_Avoid_: Rollback

**Coding worker**:
The isolated agent that implements a feature and performs permitted verification. It cannot exercise the controller's signing, publication, merge or cleanup authority.
_Avoid_: Delivery controller

**Delivery controller**:
The trusted coordinator that enforces the delivery contracts, records progress and performs authorized repository effects. Its protected credentials and state are outside the coding worker's authority.
_Avoid_: Coding worker

**Implementation allowance**:
The configurable initial coding time allowance, defaulting to 120 active minutes and distinct from the repair budget. Exhaustion preserves progress and requires an owner extension before further implementation.
_Avoid_: Repair budget

## Runtime evidence terms

**Usage approval**: Fresh owner authorization for one observed account/window
scope and at most one operation. It grants no worker, credential or publication authority.

**Vault credential account**: The mediated subscription credential's identity
(issuer, client, subject and host). Online plans and relays use it.

**Endorsed usage account**: The usage reader's identity for the same
subscription. The owner endorses it in the mediation decision record, and every
check against observed usage compares with it, never with the vault account.

**Session**: A dispatched worker or online operation whose matching receipt must
prove descendant shutdown. Retained uncertain sessions prevent ownership release.

**Fence**: A monotonically advancing repository generation used with an owner
identity to reject stale session actions and ownership writes.

**Qualification**: Version-bound evidence for a defined runtime boundary. A
passing fixed canary does not qualify production delivery or another platform.

**Canary**: A bounded fixed challenge using synthetic inputs, capabilities and
controlled peers to test a specific boundary without owner credentials/inference.
