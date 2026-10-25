# Issue 04 slice 3, step 3b: the relay channel and the release action

Base: `main` at `201bce6`, after the security audit's #111 and #112. 25 October 2026. No inference, no credentials, no
native run.

## What changed

A routed coding turn now has a working path to the model through the
**session relay** (ADR 0002, "The channel (slice 3b)"; `CONTEXT.md`).
Nothing creates a route yet; slice 4 wires usage and routing, so the
controller's turns stay offline.

- **`src/session-relay.ts` (new).**
  - `sessionRelaySource`: the relay's Python. Guest management embeds it, so
    the coding `policySha256` covers it. It accepts only the session's exact
    `POST /v1/responses`: one capability, one delivery header, JSON, a
    bounded `Content-Length` body of strict UTF-8 JSON naming the pinned
    model. Upgrades, chunked or encoded bodies, expectations, query strings,
    unknown methods and malformed requests are refused with an empty 403.
    The one exception is a request line Python reads as HTTP/0.9, which gets
    no reply at all. It listens only if its network namespace is the
    worker's, and it reports its own pid when ready. It serves one request at a time,
    forwards only the body, and writes the host's chunks as server-sent
    events ended by closing the connection. It exits when its channel
    closes, on any frame out of step, and when the host is silent past the
    response gap. A worker that hangs up mid-stream leaves it in step for
    the next request.
  - `openSessionRelay`: the host bridge. Each body goes to
    `SessionGateway.respond(deliveryId, gateway.capability, body)`, and the
    reply streams back in chunks of at most 64 KiB. A refusal before any
    bytes becomes an empty 403, and a failure mid-stream cuts the response.
    A malformed or out-of-order frame, a body that is empty, over 4 MiB, not
    canonical base64 or not UTF-8, an oversized line, over 1 MiB of
    diagnostics, or the channel ending loses the relay. Losing it revokes
    the gateway, closes the in-flight stream and kills the channel.
- **`openManagementChannel`** (`src/native-management.ts`): one long-lived
  `podman machine ssh /usr/bin/python3 -I -u -c <bootstrap>` per routed
  turn. The program and its request cross as one base64 stdin line, as for
  the fixed worker's relay.
- **Guest program** (`src/podman-coding.ts`):
  - **launch** starts the container and the lease, but no longer releases
    Codex.
  - **relay** (new) is refused unless the session is routed, running, not
    yet released and has no relay, and the capability matches the admitted
    digest. It starts the relay with `podman unshare nsenter --net=…` in the
    worker's namespace. It records the process group's leader and start time
    before the relay can listen, and refuses a missing start time. It waits
    up to 15 s for the relay to report ready on 18091, then records the
    listener's own pid and start time. It then pumps frames both ways, each
    bounded, and either end closing ends both.
  - **release** (new) touches `/tmp/launch`. For a routed session, both
    recorded relay processes, the leader and the listener, must still be
    live with their recorded start times. An offline session must have no
    relay.
  - **poll** refuses a released routed session whose relay has gone.
  - **stop** first kills the leader's process group and the listener, then
    records that the relay has ended once both are gone. That kill writes
    nothing, and the record comes after the disk reserve is released, as for
    the audit's other stop records. A zombie (`Z`) or
    dead (`X`) process counts as gone.
- **Host transport.** `run(request, stdout, gateway?)` refuses before any VM
  effect in three cases: a route without a gateway, a gateway without a
  route, or a gateway whose capability equals the relay's. After launch it
  opens the relay, which must report the same pins, waiting at most 30 s,
  then releases Codex and polls. Each poll first checks that the relay has
  not been lost. When the turn ends, the relay is closed and the gateway is
  revoked exactly once, whichever side ends first.
  `IsolatedCodingTransport.run` gains the same optional `gateway`, and
  `PinnedCodingRuntime` doesn't pass one yet, so routed turns through the
  runtime are refused until slice 4.

## Evidence

- **New tests.**
  - `tests/session-relay.test.mjs`:
    - the relay process on its own:
      - 19 refusals, each an empty 403 that never reaches the host, among
        them a repeated length, an unknown method and a UTF-16 body;
      - a streamed reply, a refusal and a cut stream;
      - a frame out of order, under a long gap, so only the order check can
        end the relay;
      - a malformed request line;
      - a worker hanging up mid-stream;
      - the response-gap timeout;
      - the channel closing;
    - the bridge with a fake channel: bounded chunks, refusals kept per
      request, twelve ways to lose the relay, the stream closing when the
      relay is lost, and the ready deadline.
  - `tests/session-relay-native.test.mjs`, against the guest simulator:
    - **The routed turn.** The real relay on 18091 receives Codex 0.161.0's
      captured launch request. The gateway receives that body byte for byte,
      under its own capability, and the SSE comes back. Another capability
      is refused and never reaches the gateway. The actions run in the order
      prepare, launch, relay, release, then polls, then stop. The
      `nsenter --net` command for the worker's pid comes before the release,
      and stop ends the relay process.
    - An offline turn is released without a relay.
    - The guest refuses a release when the listener's start time has
      changed, and a poll when the listener's record has gone.
    - The guest refuses a relay whose capability was changed after the host.
      The relay never starts, and Codex is never released.
    - Losing the relay, and losing the relay's channel, both revoke the
      gateway and stop the exact session. In both cases the guest still sees
      the relay as alive, so only the host can notice.
    - The three host refusals above, each before any VM effect.
  - **Updated tests.**
    - The existing sequence test now expects `release`.
    - Every routed test in `tests/worker-native-coding.test.mjs` passes a
      gateway, so each refusal still comes from the check it was written
      for, not from the missing gateway.
- **Mutants: 30 tried, 30 killed.** That count includes the stop-order mutant above. The first round killed 20 of 22.
  - The two survivors:
    - the relay action skipping its capability check, which no test
      reached;
    - the relay ignoring a frame out of order. That test still passed,
      because the relay also exits at its response-gap timeout.

    Both now have tests that only the right check passes.
  - A third mutant, the guest ignoring the listener record, first survived
    because of a harness bug. The poll fault crashed the simulator on its
    second poll, which looked like the refusal the test expected. The fault
    is fixed and the mutant is now killed.
  - The mutants covered:
    - **Guest:** launch also releasing Codex; release or poll skipping
      the relay check; the relay action skipping the capability check;
      stop leaving the relay; liveness ignoring the start time or the
      listener.
    - **Relay:** ignoring the capability, the delivery or the model;
      admitting a query string, an expectation, a chunked or non-UTF-8
      body; answering errors itself; reporting no pid; ignoring stale
      frames, a mid-stream hang-up or the response gap; outliving its
      channel.
    - **Host:** skipping the route and gateway pairing; allowing a shared
      capability; ignoring a lost relay; releasing without a relay;
      revoking twice.
    - **Bridge:** keeping the gateway on loss; ignoring request order;
      admitting non-UTF-8; unbounded chunks.
- **Full local suite on `201bce6`, with the CI fixes below: 1,217 tests,
  1,214 pass, 0 fail, 3 skipped,** in 221 s. It ran with the Mac settings from `ticket04-gateway-shape-receipt.md`.
  Formatting is clean (`prettier --check`).
- **Factory coverage gate:** not run on this Mac for this change. The last
  two gate runs (step 3a) ended at load-sensitive 5-second Python checks,
  with every stage within a few seconds of its 240 s limit. CI's Factory
  coverage check is the verdict.

## CI on the first push (`5695018`), fixed

- **Windows CLI tests.** Two relay tests failed with an unhandled
  `read ECONNRESET`. In both, the relay exits on purpose while a client
  connection is open, and Windows reports a reset where POSIX reports a
  close. Those exchanges now accept either.
- **Factory coverage.** Lines passed. Changed branches were 84/93 (90.3%)
  against a 90% bar. Global branch coverage was 6,065/6,517 (93.06%), below
  the 93.11% baseline, and no decrease is allowed. All 9 uncovered branches
  were refusal or edge paths in the new code. New host-side tests now cover
  each one:
  - a ready frame without `ready: true`;
  - a ready frame on another session, or bound to another VM;
  - a release bound to another VM;
  - authority withdrawn just before the relay opens;
  - the bridge waiting on `drain`, and leaving no listeners afterwards;
  - frames arriving after the relay is lost;
  - an oversized line that ends in a newline;
  - a ready frame that isn't an object.
- **The two human-approval checks** need a current-head human review.
- **Windows shard 4/8 timing out (on `53a57f2` and `3e26967`).** The two new
  test files shifted the sorted file list. That put the two heaviest
  controller files, `worker-coding-lifecycle` and `zz-feature-coding-session`,
  into one Windows shard. It took 9–10 minutes against the job's 10-minute
  limit, where `main` takes 4–6.
  - The simulator file is now `tests/session-relay-native.test.mjs`. It sorts
    before both heavy files, so they stay in separate shards, and
    `zz-feature-coding-session` gets a shard of its own.
  - That file was already close to the limit on `main`: PR 112's own run
    timed out once at 10 min 8 s in a shard it shared with
    `podman-platform`.
  - No timeout was changed.

## Review

An independent review found no critical issues. It confirmed:
- The gateway's capability never crosses to the VM.
- Codex can't be released, or keep running, without a live relay.
- Frames stay in step.

It raised these, all fixed before publication:
- **Medium:**
  - Two test files could each bind a relay on 18091 at once. The simulator
    now runs it on a free port.
  - The pid recorded was the `podman unshare` leader, not the listener,
    and nothing checked the network namespace. The listener is now recorded
    and checked, and the relay checks its own namespace.
  - Waiting for `drain` leaked `close` listeners.
  - The host's 15 s ready deadline was no longer than the guest's wait for
    the relay alone.
- **Low:**
  - Stop killed the relay only after the container stopped.
  - A missing start time read as alive.
  - A body the worker encoded as UTF-16 stopped the session instead of
    getting a 403.
  - `send_error` sent a 501 or 400 with a body instead of an empty 403.
  - A failed open revoked the gateway twice.
- **Test gaps:** listed under Evidence, now covered.

## Fits the audit's disk-full stop (#111, #112)

**A gap in #111, fixed in #112.** If the worker had exited before the disk
filled, stop's `stop_timers()` saved the record before the reserve was
released. That save failed, and shutdown was reported as uncertain. Building
3b's routed disk-full test found it, and #112 fixed it (`e3c7a54`). The
reserve is now released before the timers stop.

**3b's records come after that release.** The relay's end is recorded after
`reserve(False)` and before `stop_timers()`. The early `kill_relay()` writes
nothing. The routed test "a routed worker that fills the shared disk and
exits still has its relay ended at shutdown" kills the mutant that writes
the relay's record before the release.

## Found while building

- **A race in the bridge.** The bridge first cleared its one-request flag
  only after writing a request's final frame. A relay that answered at once
  could then send its next request inside that gap, and the bridge would
  wrongly treat it as a protocol violation. The bridge test found it. The
  flag is now cleared before the final frame is written.

## Not covered (native)

- **Not yet run on either host:** `podman unshare nsenter` into a coding
  worker, and Codex reading a reply ended by closing the connection. The
  capture's replies carried a `Content-Length`. Step 4 and the offline
  native check need to show both.
- **Not shown by the simulator.** It runs the relay directly. So the
  namespace check, podman's real process tree under `podman unshare`, and
  real `/proc` start times are shown only by a native run.
- **Unreached guards.** Two guest guards have no test that reaches them:
  - a second relay for the same session;
  - a relay present on an offline release.

  The host never asks for either.

## Open (owner decisions, unchanged)

- **Route continuity across resume.** See the 3a receipt.
- **Suite headroom on this Mac.** The new simulator tests add about
  6 seconds.
- **Re-approve both hosts' coding admission records** once this merges.
  `policySha256` changes again here.
