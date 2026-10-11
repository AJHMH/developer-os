// Explicit host acceptance: never called by automatic tests or CI.
import { spawn } from "node:child_process";
import { mkdirSync, realpathSync, rmdirSync } from "node:fs";
import { join } from "node:path";

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
try {
  mkdirSync(lock, { mode: 0o700 });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.error(
    `Native acceptance lock exists: ${lock}. Verify prior runners and workers have stopped before removing it.`,
  );
  process.exit(1);
}
let activeChild;
let interrupted = false;
const interrupt = (signal) => {
  interrupted = true;
  activeChild?.kill(signal);
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
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
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (interrupted) {
    process.exitCode = 1;
    console.error(
      `Acceptance interrupted; lock retained at ${lock}. Verify runners and workers have stopped before removing it.`,
    );
  } else {
    rmdirSync(lock);
  }
}
