# Issue 04 slice 4d: native macOS run of the usage canary

29 October 2026. macOS 27.2.0 arm64, VM `aios-macos-noshare`. No inference,
no credentials, no guest change. The owner's coding admission record
(approved 27 October) named the fresh pins on every run.

## First run: blocked, and the defect it found

From clean, built `main` at `e0239ee`, the canary blocked at
`routed-launch-exhausted-mid-turn` with "Native coding observe-session
observation unavailable". Report SHA-256
`a7441583abae4b35d0050a36cbe811bda9a950d836ebe544f63de622b9b222ff`. The
session was stopped by its exact identity.

Diagnosis (8 instrumented reruns, all blocked the same way; their reports are
kept as `issue04-usage-canary-debug-*.json`):
- The guest held only a stop record for the session, with no binding or
  admission, so it had never been prepared or launched. The observation
  failed on that record, not on the turn.
- The turn itself was refused by `NativePodmanCodingTransport.run` before any
  VM effect: "Unsupported native coding launch". The controller built the
  turn's route with the gateway's own capability (slice 4a), and the
  transport refuses a gateway sharing the relay's capability, as ADR 0002
  requires: the relay's capability goes into the VM, the gateway's stays on
  the host.
- `PinnedCodingRuntime` required the two capabilities to be equal, and the
  simulated canary's VM did not apply the transport's check, so the
  contradiction passed every test. The controller recorded the refusal only
  as a `failed` coding outcome.

Fix: the controller draws a fresh random relay capability for each routed
turn; the runtime refuses a gateway sharing it; the simulated VM refuses as
the native transport does. The three tests went red before the fix.

## Passing run

From the fix's clean, built branch head `e1e5366`:
`observed-offline-usage-canary`. Report
`~/.developer-os/issue04-usage-canary-20261029-114713.json`, SHA-256
`827a1d769a0686e63771b309d775095be3df38f7a69d3c3e444d5e38a947e66a`.

- Bindings: Codex 0.161.0, CLI `0129f94f…`, code-mode host `64efe295…`,
  policy `829e7e1e…`, binding `aac1b6b5…`; gateway version `7df3a76b…`; dist
  `c12b8df2…`; runner `d0348168…`. Production disabled, inference not
  authorized, decision not qualified for inference.
- Before any turn: unknown usage refused even approved; low usage refused
  until approved.
- Launch (34 s): the thread started; the provider answered 2 requests; the
  next was refused; revoked and recorded as `exhausted`; stopped exactly
  (0 processes); workspace kept as `interrupted-turn` evidence
  (`index.html`), no candidate.
- Restart without approval: refused.
- Resume (29 s): the launch's thread under the same route; revoked and
  recorded as `withdrawn` after 2 requests; stopped exactly; evidence only.
- New lineage (26 s): new thread under the new decision, old lineage
  superseded, work script run through the route, completed with a candidate.
- Final stops: all three sessions stopped again by exact identity.

The run was from the branch head, not merged `main`; it is rerun from
`main` after merge to bind the merged revision.

## Still to do

- The Windows run, on the owner's PC (command in
  `docs/worker-qualification.md`, "Usage canary").
- Slice 5's credentialed runs. Production remains disabled.
