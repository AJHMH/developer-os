// Backs a test's fake VM with the guest simulator, for the owner-run scripts
// whose turns need a model or a controller. The fake answers the turn as it
// always has; each session it ran is then also launched in the simulator under
// the same exact identity, predecessor and thread. Cleanup goes to the real
// guest program, so a script is shown to name heads the guest accepts, and to
// leave nothing behind. No real VM, engine or credentials are used.
//
// A fixture mocks the host's file and process modules, and a controller keeps
// using its own files while a turn runs, so each guest call runs in a process
// of its own (guest-session-call.mjs), against the simulator's root on disk.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  realMkdtempSync,
  realReadFileSync,
  realRmSync,
  realSpawnSync,
  realTemporaryDirectory,
  realWriteFileSync,
} from "./native-coding-fixture.mjs";

/** The session a chunk of turn output reports, if any: Claude Code's init
 * event names it. */
function threadIn(chunk) {
  for (const line of chunk.toString().split("\n"))
    try {
      const event = JSON.parse(line);
      if (event?.type === "system" && event.subtype === "init")
        return event.session_id;
    } catch {}
}

/** What a simulated VM still holds: containers and session folders. */
export function sessionsLeft({ root, read }) {
  const listing = realSpawnSync(
    "find",
    [
      `${root}/.local/state/aios-coding-v1`,
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "-type",
      "d",
    ],
    { encoding: "utf8" },
  ).stdout;
  return {
    containers: Object.keys(read().containers ?? {}),
    folders: listing
      .split("\n")
      .filter((path) => /\/aios-coding-[a-f0-9]+$/.test(path)),
  };
}

export function guestBackedSessions(t) {
  const root = realMkdtempSync(`${realTemporaryDirectory}/aios-guest-backed-`);
  t.after(() => realRmSync(root, { recursive: true, force: true }));
  const statePath = `${root}/engine.json`;
  realWriteFileSync(
    statePath,
    JSON.stringify({
      commands: [],
      container: null,
      alive: false,
      keepRunning: true,
    }),
  );
  const guestProcess = (action, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./guest-session-call.mjs", import.meta.url)),
          root,
          action,
          JSON.stringify(input),
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      const out = [];
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.once("error", reject);
      child.once("close", () => {
        try {
          const { error, result } = JSON.parse(Buffer.concat(out).toString());
          if (error !== undefined) reject(Error(error));
          else resolve(result);
        } catch {
          reject(Error(`The guest call ${action} gave no answer`));
        }
      });
    });
  // One at a time, in order: a controller doesn't wait for a turn it ended
  // over usage, so its next turn can arrive while this one is being mirrored.
  let queue = Promise.resolve();
  const call = (action, input) => {
    const answer = queue.then(() => guestProcess(action, input));
    queue = answer.catch(() => {});
    return answer;
  };
  const mirrored = new Set();
  /** Launch, and stop on `thread`, a session the fake just ran. */
  const mirror = (request, thread) => {
    mirrored.add(request.operationId);
    return call("mirror", {
      operationId: request.operationId,
      fence: request.fence,
      intent: request.intent,
      threadId: request.threadId,
      resumeFrom: request.resumeFrom,
      thread,
    });
  };
  const clean = (session) => call("clean", session);

  return {
    /** `fake`, with its sessions mirrored and its cleanup done by the guest.
     * Receipts carry the fake's pins, which are what the script admitted. */
    transport: (fake) => ({
      ...fake,
      async run(request, stdout, gateway) {
        let thread = request.threadId;
        try {
          return await fake.run(
            request,
            (chunk) => {
              thread ??= threadIn(chunk);
              stdout(chunk);
            },
            gateway,
          );
        } finally {
          await mirror(request, thread);
        }
      },
      async cleanupSupersededLineage(session) {
        return { ...(await clean(session)), pins: await fake.inspect() };
      },
      // The scripts' last stop reaches every session, cleaned ones included.
      async stop(session) {
        if (mirrored.has(session.operationId)) await call("stop", session);
        return fake.stop(session);
      },
    }),
    /** Mirror one finished session for a script that drives no transport. */
    mirror,
    /** Clean one mirrored session in the guest. */
    clean,
    /** How many sessions the simulator launched. */
    launched: () => mirrored.size,
    left: () =>
      sessionsLeft({
        root,
        read: () => JSON.parse(realReadFileSync(statePath, "utf8")),
      }),
  };
}
