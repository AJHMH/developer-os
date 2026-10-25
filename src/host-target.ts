/** Supported host facts. Native bindings use kernel releases; product versions
 * require an explicit domain when inspecting host metadata. */
export const hostTargets = {
  win32: {
    platform: "win32",
    arch: "x64",
    provider: "hyperv",
    guestArch: "amd64",
    displayName: "Windows",
    minimumBuild: 22000,
    minimumKernelMajor: 0,
    minimumProductMajor: 0,
    imageReference: "ostree-unverified-registry:quay.io/podman/machine-os:6.0",
    offlineTemplate:
      "docker.io/library/alpine@sha256:3e9b4b680bfc9fb5269227cffbd6d42be39fbf7c0b908123913864aa4447e764",
    codexWorkerSha256:
      "9a820c17865fa825d04db416818679a9d63bd72e50835c396f496e5684626c9c",
    // The same official package's bin/codex-code-mode-host (ADR 0002 amendment).
    codeModeHostSha256:
      "e87096087c02aa6ab90a5a85031659665aa0bf3ee20c07ca0b8ab701c83fcd5b",
    nativeCodexSha256:
      "a0f89acca07a511734cac7fddee26b2106fab68918717bc90df16104a0760a30",
    commandMs: 10_000,
    managementMs: 30_000,
    guestCommandSeconds: 15,
  },
  darwin: {
    platform: "darwin",
    arch: "arm64",
    provider: "applehv",
    guestArch: "arm64",
    displayName: "macOS",
    minimumBuild: 0,
    minimumKernelMajor: 23,
    minimumProductMajor: 14,
    imageReference: "ostree-unverified-registry:quay.io/podman/machine-os:6.1",
    offlineTemplate:
      "docker.io/library/alpine@sha256:24bb3511a0db7b5114a4aee033c65a8a4148f39b7b80a398e548546db967a36f",
    codexWorkerSha256:
      "0129f94f4f1197bd75f6c4265889061f386ed302bbc50c6e57e3e0660dfb28a7",
    codeModeHostSha256:
      "64efe2950af9d8ac9e9b94b0aac5e41f56307422e34e66a4217aaea0a221fed0",
    nativeCodexSha256:
      "12ac11d2c7eee27cfae34393986d7b7c9ed0dea537cb749831cdd7033893e6de",
    commandMs: 30_000,
    managementMs: 90_000,
    guestCommandSeconds: 30,
  },
} as const;
export type HostPlatform = keyof typeof hostTargets;
export type HostTarget = (typeof hostTargets)[HostPlatform];

export function hostTarget(
  platform: unknown,
  arch?: unknown,
): HostTarget | undefined {
  const target =
    platform === "win32"
      ? hostTargets.win32
      : platform === "darwin"
        ? hostTargets.darwin
        : undefined;
  return target && (arch === undefined || arch === target.arch)
    ? target
    : undefined;
}

export function supportsHostOS(
  target: HostTarget,
  version: unknown,
  domain: "kernel" | "product" = "kernel",
): boolean {
  if (typeof version !== "string") return false;
  if (target.platform === "win32")
    return (
      /^10\.0\.\d+$/.test(version) &&
      Number(version.split(".")[2]) >= target.minimumBuild
    );
  return (
    (domain === "kernel"
      ? /^\d+\.\d+\.\d+$/.test(version)
      : /^\d+\.\d+(?:\.\d+)?$/.test(version)) &&
    Number(version.split(".")[0]) >=
      (domain === "kernel"
        ? target.minimumKernelMajor
        : target.minimumProductMajor)
  );
}
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validHostBinding(
  value: unknown,
  expected?: HostPlatform,
): boolean {
  if (!value || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>,
    target = hostTarget(binding.platform, binding.arch);
  return Boolean(
    target &&
      (!expected || target.platform === expected) &&
      binding.provider === target.provider &&
      supportsHostOS(target, binding.osVersion) &&
      typeof binding.machine === "string" &&
      /^aios-[a-z0-9-]+$/.test(binding.machine) &&
      sha256(binding.hostId) &&
      sha256(binding.vmImageSha256) &&
      typeof binding.template === "string" &&
      /^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(binding.template) &&
      typeof binding.engineVersion === "string" &&
      /^\d+\.\d+\.\d+$/.test(binding.engineVersion) &&
      typeof binding.workerVersion === "string" &&
      /^\d+\.\d+\.\d+$/.test(binding.workerVersion),
  );
}
export function validEffectiveControls(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const controls = value as Record<string, unknown>;
  return (
    controls.hypervisor === true &&
    controls.dedicated === true &&
    controls.managementExposed === false &&
    controls.rootful === false &&
    controls.network === "none" &&
    controls.readOnly === true &&
    controls.user === "65534:65534" &&
    controls.noNewPrivileges === true &&
    Array.isArray(controls.mounts) &&
    controls.mounts.length === 0 &&
    Array.isArray(controls.capabilities) &&
    controls.capabilities.length === 0
  );
}
export function codexWorkerSha256(
  platform: string,
  arch: string,
): string | undefined {
  return hostTarget(platform, arch)?.codexWorkerSha256;
}
export function codeModeHostSha256(
  platform: string,
  arch: string,
): string | undefined {
  return hostTarget(platform, arch)?.codeModeHostSha256;
}
export const qualificationCheckNames = [
  "hostBinding",
  "offlineTransfer",
  "adversarialIsolation",
  "onlinePolicy",
  "authentication",
  "usageGate",
  "fencingRecovery",
  "syntheticTask",
  "isolatedValidation",
] as const;
