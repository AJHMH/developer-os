// The warning every owner run prints when Podman Desktop is open on macOS,
// with no real process. The name sorts after every other test file, so no
// other file changes shard.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  podmanDesktopRunning,
  podmanDesktopWarning,
  warnIfPodmanDesktop,
} from "../scripts/podman-desktop.mjs";

const macOS = (probe) => () =>
  podmanDesktopRunning({ platform: "darwin", probe });
/** Every warning the check gives. */
function warnings(podmanDesktop) {
  const lines = [];
  warnIfPodmanDesktop({ podmanDesktop, warn: (line) => lines.push(line) });
  return lines;
}

test("an owner run warns once when Podman Desktop is running, and carries on", () => {
  assert.deepEqual(warnings(macOS(() => ({ status: 0 }))), [
    podmanDesktopWarning,
  ]);
  assert.doesNotMatch(podmanDesktopWarning, /\n/);
});

test("it says nothing when Podman Desktop is not running", () => {
  assert.deepEqual(warnings(macOS(() => ({ status: 1 }))), []);
});

test("it says nothing off macOS, without looking for the app", () => {
  for (const platform of ["linux", "freebsd"])
    assert.deepEqual(
      warnings(() =>
        podmanDesktopRunning({
          platform,
          probe: () => assert.fail("The check ran off macOS"),
        }),
      ),
      [],
    );
});

test("a check that fails counts as not running", () => {
  const failures = [
    () => {
      throw Error("spawn failed");
    },
    // No such program, or a timeout: spawnSync reports no status.
    () => ({ status: null, error: Error("ENOENT") }),
    // pgrep's own error statuses.
    () => ({ status: 2 }),
    () => ({ status: 3 }),
  ];
  for (const probe of failures) assert.deepEqual(warnings(macOS(probe)), []);
});

test("the check looks for the app's path among host processes, and can't hang a run", () => {
  const calls = [];
  podmanDesktopRunning({
    platform: "darwin",
    probe: (...call) => {
      calls.push(call);
      return { status: 1 };
    },
  });
  assert.equal(calls.length, 1);
  const [[program, args, options]] = calls;
  assert.equal(program, "/usr/bin/pgrep");
  assert.deepEqual(args, ["-f", "Podman Desktop.app"]);
  assert.equal(options.stdio, "ignore");
  assert.ok(options.timeout > 0);
});
