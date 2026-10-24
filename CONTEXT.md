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

**Usage interruption**: A coding turn stopped because its usage authority
lapsed during the turn or before its output was collected (exhaustion, an
account change or a lost observation). The thread is preserved, and coding
stays blocked until a coding restart approval.

**Owner coding admission**: An owner-written record, kept privately on one
host and never in a repository, that names the exact pins (CLI version and
digest, management policy, host and VM binding) of one live coding transport.
The pinned coding runtime re-reads it before dispatch, on results and
receipts, and at least once a second while a turn streams, so editing or
removing it, or any pin change, stops further coding. It admits coding turns
only; it never enables production delivery.
_Avoid_: enablement flag, production switch

**Owner validation admission**: An owner-written record, kept privately on one
host and never in a repository, that names the exact pins (validation image ID,
management policy, host and VM binding) of one live validation transport. It
is separate from owner coding admission. The pinned validation runtime re-reads
it before each check, at every effect and poll of a running check, on results
and when trusting a stop, so editing or removing it, or any pin change, stops
further checks. It admits offline validation checks only; it never enables
production delivery.
_Avoid_: validation enablement, coding record

**Offline validation environment**: The only validation environment the native
validation runtime offers: the owner-loaded image by ID, the fixed "no
network" policy digest, no registries, no caches and no browser or database
fixtures. An owner contract must declare exactly this environment; any other
declaration is refused before a check runs.
_Avoid_: sandbox profile, network allowlist

**Coding restart approval**: The owner's decision to restart coding after a
usage interruption. It names the interrupted operation and records the
feature's account, which every turn must use anyway. The one re-dispatch that
passes the controller's dispatch recheck spends it, and it never replaces the
fresh usage authority every turn needs.

**Coding-session resume**: A new coding turn that continues the Codex
conversation of an exact stopped predecessor session, named to the coding VM
by operation and fence rather than by a "last session" lookup. It needs fresh
authority like any turn, and repair turns never resume.
_Avoid_: Resume (unqualified; a delivery's resumption leaves a pause)

**Retained session home**: A stopped coding session's private Codex home in
the coding VM. A resume reserves it, one successor at a time, and moves it into
its own session. Codex's regenerated `skills/.system` and temp folders are
removed first; any other configuration, link or unusual file refuses the
resume.

**Resume recovery**: Settling a resume that stopped before it launched: any
retained session home it had taken returns to its predecessor and the
reservation is released, so the predecessor can be resumed again. The
recovered resume itself is never resumed.

**Resume reconciliation**: Settling a resume that launched but never reported
its thread to the controller, by the coding VM's own record. Adopted: the VM
recorded the expected thread, so the resume becomes the next predecessor.
Unresolved: it recorded none, or reconciliation can't be verified, so coding
stays blocked until the owner retires the lineage (see Retired resume
lineage).

**Base move**: A coding resume that continues its conversation onto a main
that moved since its predecessor's turn. It names the exact old and new
revisions, needs a passed baseline for the new main, builds its workspace from
the new main and tells Codex the base changed. Only allowed before any
candidate exists; an admitted candidate refreshes through repair.
_Avoid_: Base refresh (that is repair's merge-base refresh)

**Retired resume lineage**: A resumed coding session the owner retired because
its launched resume never reported a thread, together with every predecessor
it was resumed from. It is never resumed again; coding restarts fresh.

**Lineage cleanup**: The owner's explicit removal of a retired resume
lineage's session folders and stopped containers inside the coding VM. Guest
records stay as tombstones, and the delivery records the cleanup once.

**Session**: A dispatched worker or online operation whose matching receipt must
prove descendant shutdown. Retained uncertain sessions prevent ownership release.

**Fence**: A monotonically advancing repository generation used with an owner
identity to reject stale session actions and ownership writes.

**Qualification**: Version-bound evidence for a defined runtime boundary. A
passing fixed canary does not qualify production delivery or another platform.

**Canary**: A bounded fixed challenge using synthetic inputs, capabilities and
controlled peers to test a specific boundary without owner credentials/inference.

**General session gateway**: The host side of a mediated general coding
session (ADR 0002). It carries a session's Responses requests for the pinned
model only, within a session grant: one delivery, coding session, account and
deadline, with a request budget. Fresh authority must permit each request,
and it revokes the grant irreversibly on anything else. It is separate from the
fixed-worker gateway and never lets the credential reach the VM.

**Boundary probe**: The fixed canary script that each general worker runs inside
its own hardened container. It has a positive control (the admitted file is
visible and alone), and it shows denial of host and guest content, sockets,
credentials, network and escapes. A passing probe is qualification evidence,
not a qualification decision.
