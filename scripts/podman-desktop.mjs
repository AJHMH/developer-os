// The warning an owner run prints when Podman Desktop is open on macOS.
import { spawnSync } from "node:child_process";

export const podmanDesktopWarning =
  "Warning: Podman Desktop is running. While it's open, a qualify can slow down and stop at any stage (docs/macos-worker-qualification.md). Continuing.";

/** Whether Podman Desktop is running on this macOS host. Off macOS, or when
 * the check itself fails, the answer is no: this only decides a warning. */
export function podmanDesktopRunning({
  platform = process.platform,
  probe = spawnSync,
} = {}) {
  if (platform !== "darwin") return false;
  try {
    return (
      probe("/usr/bin/pgrep", ["-f", "Podman Desktop.app"], {
        stdio: "ignore",
        timeout: 5_000,
      }).status === 0
    );
  } catch {
    return false;
  }
}

/** Warns once on stderr when Podman Desktop is running, and changes nothing
 * else. */
export function warnIfPodmanDesktop({
  podmanDesktop = podmanDesktopRunning,
  warn = console.error,
} = {}) {
  if (podmanDesktop()) warn(podmanDesktopWarning);
}
