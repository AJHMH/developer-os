// Explicit host acceptance: never called by automatic tests or CI.
import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { warnIfPodmanDesktop } from "./podman-desktop.mjs";

const [state, ...rest] = process.argv.slice(2);
const separator = rest.indexOf("--");
if (!state || separator < 1) {
  console.error(
    "Usage: node scripts/run-native-acceptance.mjs <state-dir> <script>... -- <script-args>...",
  );
  process.exit(1);
}
const scripts = rest.slice(0, separator);
const args = rest.slice(separator + 1);
const lock = join(realpathSync(state), ".native-acceptance.lock");
const owner = join(lock, "owner.json");
function lockOwner() {
  let holder;
  try {
    holder = JSON.parse(readFileSync(owner, "utf8"));
  } catch {
    return "It names no owner.";
  }
  let running = true;
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    running = error.code !== "ESRCH";
  }
  return `Started ${holder.startedAt} by process ${holder.pid} (${running ? "a process with that ID is running" : "no process with that ID is running"}), for ${holder.scripts.join(", ")}.`;
}
try {
  mkdirSync(lock, { mode: 0o700 });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.error(
    `Native acceptance lock exists: ${lock}. ${lockOwner()} Verify prior runners and workers have stopped before removing it with rm -r.`,
  );
  process.exit(1);
}
// Refusals name the holder, so a stale lock can be judged by looking it up.
writeFileSync(
  owner,
  JSON.stringify({
    pid: process.pid,
    scripts,
    startedAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);
// Before any script runs, so the owner sees it first.
warnIfPodmanDesktop();
let activeChild;
let interrupted = false;
const interrupt = (signal) => {
  interrupted = true;
  activeChild?.kill(signal);
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let awake;
let awakeClosed;
try {
  if (process.platform === "darwin") {
    // Keep only this explicit native run awake. The PID binding also releases
    // the assertion if the runner is killed before reaching its finally block.
    awake = spawn("/usr/bin/caffeinate", ["-is", "-w", String(process.pid)], {
      stdio: "ignore",
      shell: false,
    });
    awakeClosed = new Promise((resolve) => awake.once("close", resolve));
    await new Promise((resolve, reject) => {
      awake.once("spawn", resolve);
      awake.once("error", reject);
    });
  }
  for (const script of scripts) {
    if (interrupted) break;
    const code = await new Promise((resolve, reject) => {
      activeChild = spawn(process.execPath, [script, ...args], {
        stdio: "inherit",
      });
      activeChild.once("error", reject);
      activeChild.once("close", (code, signal) => {
        if (signal) interrupted = true;
        resolve(signal ? 1 : code);
      });
    });
    activeChild = undefined;
    if (code !== 0) {
      process.exitCode = code ?? 1;
      break;
    }
  }
} finally {
  awake?.kill();
  if (awakeClosed) await awakeClosed;
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (interrupted) {
    process.exitCode = 1;
    console.error(
      `Acceptance interrupted; lock retained at ${lock}. Verify runners and workers have stopped before removing it with rm -r.`,
    );
  } else {
    rmSync(lock, { recursive: true });
  }
}
