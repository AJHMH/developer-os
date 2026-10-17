import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { hostTarget, supportsHostOS } from "./host-target.js";

/** Only explicitly supported host/provider pairs. Guest controls are observed separately. */
export function podmanPlatform() {
  const target = hostTarget(platform(), arch());
  if (!target || !supportsHostOS(target, release()))
    throw Error("Unsupported native host");
  const windows = target.platform === "win32";
  return {
    ...target,
    osVersion: release(),
    executable: windows
      ? join(homedir(), "AppData", "Local", "Programs", "Podman", "podman.exe")
      : "/opt/podman/bin/podman",
    cwd: windows ? (process.env.SystemRoot ?? "C:\\Windows") : "/",
    env: windows
      ? {
          SystemRoot: process.env.SystemRoot,
          USERPROFILE: homedir(),
          LOCALAPPDATA: join(homedir(), "AppData", "Local"),
          APPDATA: join(homedir(), "AppData", "Roaming"),
          PATH: `C:\\Program Files\\Git\\usr\\bin;${process.env.SystemRoot}\\System32`,
        }
      : {
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
    const actual = realpathSync(file),
      expected = resolve(file);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.nlink !== 1 ||
      (host.platform === "win32"
        ? actual.toLowerCase() !== expected.toLowerCase()
        : actual !== expected)
    )
      throw Error("Unsafe native path");
  }
  if (lstatSync(path).size > 65536)
    throw Error("Invalid machine configuration");
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (
    config.Name !== machine ||
    config.Version !== 1 ||
    !(host.provider === "hyperv"
      ? config.HyperVHypervisor
      : config.AppleHypervisor) ||
    !Array.isArray(config.Mounts) ||
    config.Mounts.length ||
    config.HostUser?.Rootful !== false ||
    (host.provider === "applehv" &&
      (config.Rosetta !== false ||
        config.AppleHypervisor.Vfkit?.Rosetta !== false ||
        config.AppleHypervisor.Vfkit?.BinaryPath !== null ||
        config.ImportNativeCA !== false ||
        config.Ansible !== null ||
        !Array.isArray(config.Resources?.USBs) ||
        config.Resources.USBs.length))
  )
    throw Error("Unsafe machine configuration");
  if (
    host.platform === "win32" &&
    !existsSync("C:\\Program Files\\Git\\usr\\bin\\ssh.exe")
  )
    throw Error("Missing trusted SSH");
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
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw Error("Observation unavailable");
  return result.stdout;
}
