import type { CodingPins, CodingSession } from "./feature-candidate.js";
import type { NativePodmanCodingTransport } from "./podman-coding.js";

/** Explicit offline acceptance seam, never a production qualification grant. */
export interface NativeControllerLossProbe {
  transport: Pick<
    NativePodmanCodingTransport,
    "inspect" | "observeSession" | "observeTimerExecution" | "stop" | "collect"
  >;
  controller: {
    start(): Promise<void>;
    /** Must confirm termination of the owned controller without running cleanup. */
    terminate(): Promise<void>;
  };
  session: CodingSession;
  pins: CodingPins;
  timer: "lease" | "deadline";
  clock: { now(): number; wait(ms: number): Promise<void> };
  onEvidence(stage: string, value: unknown): void;
}

export async function observeNativeControllerLoss(
  probe: NativeControllerLossProbe,
) {
  const { transport, controller, clock, onEvidence, timer } = probe;
  const session = structuredClone(probe.session);
  const pins = structuredClone(probe.pins);
  const fail = (reason: string): never => {
    throw Error("Native controller-loss observation blocked: " + reason);
  };
  if (
    !["lease", "deadline"].includes(timer) ||
    session.intent !== "start" ||
    session.state !== "running" ||
    session.threadId
  )
    fail("require a fresh offline session and explicit timer");
  const samePins = (value: CodingPins) =>
    JSON.stringify(value) === JSON.stringify(pins);
  const bound = (value: {
    operationId: string;
    fence: number;
    pins: CodingPins;
  }) => {
    if (
      value.operationId !== session.operationId ||
      value.fence !== session.fence ||
      !samePins(value.pins)
    )
      fail("session or runtime changed");
  };
  let previousTime = clock.now();
  if (!Number.isFinite(previousTime)) fail("clock unavailable");
  const now = () => {
    const value = clock.now();
    if (!Number.isFinite(value) || value < previousTime)
      fail("clock unavailable or moved backwards");
    previousTime = value;
    return value;
  };
  const observe = async () => {
    const value = await transport.observeSession(session);
    bound(value);
    if (value.phase !== "running")
      fail("controller cleanup or reconciliation occurred");
    onEvidence("session", structuredClone(value));
    return value;
  };
  const running = async () => {
    const value = await observe();
    if (
      !value.running ||
      value.remainingProcesses < 1 ||
      value.processesGone ||
      value.timers.lease.activeState !== "active" ||
      value.timers.deadline.activeState !== "active"
    )
      fail("positive running control unavailable");
  };
  const execution = async (selected: "lease" | "deadline") => {
    const value = await transport.observeTimerExecution(session, selected);
    bound(value);
    if (value.timer !== selected) fail("timer identity changed");
    onEvidence("timer-execution", structuredClone(value));
    return value;
  };
  let touched = false;
  try {
    if (!samePins(await transport.inspect(session)))
      fail("initial pins changed");
    now();
    onEvidence("controller-start-intent", {
      operationId: session.operationId,
      fence: session.fence,
    });
    touched = true; // An interrupted start can already have launched a worker.
    await controller.start();
    await running();
    for (const selected of ["lease", "deadline"] as const) {
      const value = await execution(selected);
      if (value.lastTriggerUs !== 0 || value.startedUs !== 0)
        fail("timer already executed before controller loss");
    }
    // For the fixed deadline probe, allow renewals before losing the controller.
    // The independent execution records, not this delay, decide which timer fired.
    if (timer === "deadline") await clock.wait(70000);
    await running();
    // Recheck after the deadline-mode wait; initial records are no longer fresh.
    for (const selected of ["lease", "deadline"] as const) {
      const value = await execution(selected);
      if (value.lastTriggerUs !== 0 || value.startedUs !== 0)
        fail("timer already executed before controller loss");
    }
    now();
    onEvidence("controller-loss-intent", { withoutCleanup: true });
    await controller.terminate();
    onEvidence("controller-terminated", { withoutCleanup: true });
    await running(); // Natural exit or pre-loss cleanup cannot masquerade as expiry.
    const deadline = now() + 45000;
    for (;;) {
      if (now() >= deadline) fail("independent stop observation timed out");
      await clock.wait(1000);
      const value = await observe();
      if (now() >= deadline) fail("late independent stop evidence");
      if (
        !value.running &&
        value.remainingProcesses === 0 &&
        value.processesGone
      )
        break;
    }
    const fired = await execution(timer);
    const other = await execution(timer === "lease" ? "deadline" : "lease");
    if (
      fired.lastTriggerUs <= 0 ||
      fired.startedUs < fired.lastTriggerUs ||
      fired.finishedUs < fired.startedUs ||
      fired.code !== 1 ||
      fired.status !== 0 ||
      other.lastTriggerUs !== 0 ||
      other.startedUs !== 0
    )
      fail("successful independent timer kill not established");
    let collectionRefused = false;
    try {
      await transport.collect(session);
    } catch {
      collectionRefused = true;
    }
    if (!collectionRefused)
      fail("collection accepted without explicit recovery");
  } finally {
    if (touched) {
      // Reconcile the owned controller before any recovery or collection.
      try {
        await controller.terminate();
      } finally {
        const stopped = await transport.stop({
          ...session,
          state: "uncertain",
        });
        if (
          !stopped.stopped ||
          stopped.remainingProcesses !== 0 ||
          stopped.operationId !== session.operationId ||
          stopped.fence !== session.fence ||
          !samePins(await transport.inspect(session))
        )
          fail("exact-session recovery uncertain");
        onEvidence("explicit-recovery", {
          stopped: true,
          remainingProcesses: 0,
        });
      }
    }
  }
  const collection = await transport.collect({ ...session, state: "stopped" });
  if (
    !collection.complete ||
    collection.operationId !== session.operationId ||
    collection.fence !== session.fence
  )
    fail("collection unavailable");
  return {
    qualified: false as const,
    productionEnabled: false as const,
    timer,
    collection,
  };
}
