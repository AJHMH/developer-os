# Issue 04: resuming a coding conversation onto a moved main

Status: implemented on `codex/issue04-base-refresh-resume`. Hosted checks and
native qualification remain open. Production remains disabled.

## The gap this closes

Once main moved, a feature with a resumable conversation was stuck:
- a new baseline was refused after coding started;
- coding was pinned to the feature's first revision;
- the feature branch was pinned to the old main;
- the guest refused any predecessor admitted on a different revision.

The owner chose to resume onto the new base, keeping the conversation, with no
extra approval.

## Behavior

- **Baseline on a moved main.** After coding started, `validateBaseline` is
  allowed again only when main moved since the feature's last turn and no
  candidate or repair exists. An admitted candidate still refreshes through
  repair.
- **Coding on a moved main.** Before any candidate exists, coding builds its
  workspace from the current main instead of refusing. The existing check
  still requires a passed baseline for exactly that main, so an unvalidated
  move refuses.
- **Feature branch.** Before any durable effect, the controller checks that the
  feature branch can follow: it must be absent, already at the new main, or an
  ancestor of it. A branch with its own commits, or a main that moved
  backwards, refuses with nothing recorded or dispatched. Just before dispatch,
  `advanceFeatureBranch` moves it with a compare-and-swap.
- **The named move.** Each session now records the main revision its workspace
  was built from. A resume whose predecessor used a different revision names
  the exact move as `baseMove: { from, to }`. A recovered resume, which never
  ran, passes on its predecessor's revision. A session recorded before
  revisions were kept names no move, so the guest refuses it if main moved
  (fail closed; retiring the lineage starts fresh). The move is:
  - recorded in `feature.baseMoves` once the turn reaches dispatch, the same
    point that spends a restart approval;
  - added to the prompt as `baseMove`;
  - bound into the pinned runtime's launch digest, so a change during pin
    inspection refuses.
- **Transport and guest.** The native transport accepts `baseMove` only on a
  resume, with exactly two keys, a valid `from` that differs from `to`, and `to`
  equal to the turn's source revision. The guest checks the same shape and
  requires the predecessor's recorded revision to equal `from`, and records the
  move in the successor's admission. Launch compares that admission exactly.
  First launches never carry a move.
- **Fresh starts.** A turn that starts a new conversation (for example after a
  retired lineage, or a first turn that never reported a thread) may also build
  from a moved main once its baseline passes. It names no move.
- Usage authority, mediation, restart approval, pins and policy checks are
  unchanged and still apply to every turn. No new owner approval is needed.
- `CONTEXT.md` defines "base move".

## Evidence

Tests go through the agreed seams:
- the public `DeliveryController` (`validateBaseline`, `codeFeature`) with the
  controlled runtime and a real fixture repository whose main moves;
- `PinnedCodingRuntime` over a controlled transport;
- `NativePodmanCodingTransport` against the external guest fixture.

Covered:
- After main moves, coding refuses until the new baseline passes. The resume
  then keeps the thread, builds from the new main, names the move, tells Codex
  and records the move.
- An unchanged base names no move.
- A recovered resume still names its predecessor's revision.
- A baseline after coding is refused when main hasn't moved, and after
  admission.
- A feature branch with its own commits, or ahead of a main that moved
  backwards, is never moved; nothing is dispatched or recorded.
- A fresh start on a moved main builds from the new main and names no move.
- The pinned adapter refuses a move changed during pin inspection, and passes an
  unchanged one.
- The guest records the named move, and refuses a move from a revision the
  predecessor never used without moving the home. The existing "source" refusal
  still covers a moved main without a named move.
- The transport rejects malformed moves and a move on a first launch before any
  guest effect.

Not separately tested: a move after an adopted successor (it keeps its own
recorded revision), and a legacy session without a recorded revision.

TDD: the controller, guest and transport tests failed first. Mutation checks:
each guard was removed in turn and the focused tests rerun. Every guard has a
failing test. The guest's own shape and first-launch checks repeat the
transport's, so the transport fails first in tests.

Review: the Standards review asked for one name (`baseMove`, matching the
glossary), a single "may move" predicate, the transport check in the resume
block, one branch read and a non-signing fixture commit. The Spec review found
that a move was recorded before it happened and that a refused branch move left
a prepared turn behind; both now happen only at dispatch or before any effect.
All are addressed.

No Codex binary, credentials, online inference or real VM was used.

## Still open

- Real Windows and macOS qualification of resume, base moves, recovery,
  reconciliation, restart and cleanup.
- Production remains disabled, and the parent ticket stays partial.
