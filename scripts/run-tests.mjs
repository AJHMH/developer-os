#!/usr/bin/env node
// Runs the suite with a no-output limit. The test runner can stall with no test
// running, where per-test timeouts never fire and it ignores SIGTERM.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Output arrives file by file, so the limit must exceed the slowest test file. */
export const quietLimitMs = 5 * 60 * 1000;

/** The CLI refuses every host but the owner's Mac. Off macOS, the suite's CLI
 * runs stand in for it; on macOS they meet the real check. */
export function testEnvironment(platform = process.platform) {
  const env = { ...process.env };
  if (platform === "darwin") delete env.AIOS_TEST_HOST_PLATFORM;
  else env.AIOS_TEST_HOST_PLATFORM = "darwin";
  return env;
}

export function runWatched(command, args, limitMs = quietLimitMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: testEnvironment(),
    });
    let stalled = false,
      timer;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        kill();
      }, limitMs);
    };
    const pass = (stream, target) =>
      stream.on("data", (bytes) => {
        target.write(bytes);
        arm();
      });
    pass(child.stdout, process.stdout);
    pass(child.stderr, process.stderr);
    arm();
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stalled)
        console.error(
          `The test run stalled: no output for ${limitMs / 1000} seconds, so it was stopped. Results above are incomplete.`,
        );
      resolve(stalled ? 1 : (code ?? 1));
    });
  });
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  process.exitCode = await runWatched(process.execPath, [
    "--test",
    "--test-concurrency=4",
    ...process.argv.slice(2),
  ]);
