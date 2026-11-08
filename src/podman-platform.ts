import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { hostTarget, supportsHostOS } from "./host-target.js";

/** Only explicitly supported host/provider pairs. Guest controls are observed separately. */
export function podmanPlatform() {
  const target = hostTarget(platform(), arch());
  if (!target || !supportsHostOS(target, release()))
    throw Error("Unsupported native host");
  return {
    ...target,
    osVersion: release(),
    executable: "/opt/podman/bin/podman",
    cwd: "/",
    env: {
      HOME: homedir(),
      PATH: "/opt/podman/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    },
  };
}

export function podmanMachine(machine: string) {
  if (!/^aios-[a-z0-9-]+$/.test(machine)) throw Error("Invalid machine");
  const host = podmanPlatform();
  const path = join(
    homedir(),
    ".config",
    "containers",
    "podman",
    "machine",
    host.provider,
    `${machine}.json`,
  );
  for (const file of [path, host.executable]) {
    const entry = lstatSync(file);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.nlink !== 1 ||
      realpathSync(file) !== resolve(file)
    )
      throw Error("Unsafe native path");
  }
  if (lstatSync(path).size > 65536)
    throw Error("Invalid machine configuration");
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (
    config.Name !== machine ||
    config.Version !== 1 ||
    !config.AppleHypervisor ||
    !Array.isArray(config.Mounts) ||
    config.Mounts.length ||
    config.HostUser?.Rootful !== false ||
    config.Rosetta !== false ||
    config.AppleHypervisor.Vfkit?.Rosetta !== false ||
    config.AppleHypervisor.Vfkit?.BinaryPath !== null ||
    config.ImportNativeCA !== false ||
    config.Ansible !== null ||
    !Array.isArray(config.Resources?.USBs) ||
    config.Resources.USBs.length
  )
    throw Error("Unsafe machine configuration");
  return { ...host, config };
}

export function podmanCommand(
  host: ReturnType<typeof podmanPlatform>,
  args: string[],
) {
  const result = spawnSync(host.executable, args, {
    cwd: host.cwd,
    env: host.env,
    encoding: "utf8",
    timeout: host.commandMs,
    maxBuffer: 65536,
    shell: false,
  });
  if (result.error || result.status !== 0)
    throw Error("Observation unavailable");
  return result.stdout;
}
