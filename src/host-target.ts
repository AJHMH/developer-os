/** Supported host facts. Native bindings use kernel releases; product versions
 * require an explicit domain when inspecting host metadata. */
export const hostTargets = {
  darwin: {
    platform: "darwin",
    arch: "arm64",
    provider: "applehv",
    guestArch: "arm64",
    displayName: "macOS",
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
    /** The Claude Code CLI the coding guest runs (ADR 0008): the native
     * binary from the official per-platform package for the guest, which is
     * musl Linux on arm64. `integrity` is the registry's tarball digest;
     * `sha256` is the `claude` binary inside it. */
    claudeCode: {
      package: "@anthropic-ai/claude-code-linux-arm64-musl",
      version: "2.1.311",
      integrity:
        "sha512-ymSGc6vv0QCcVQZCC2JG03P/upLraox+iXAG1DfnUU1OZBCIR9QncxINBEp6QgnKbqywwR2/ic3GD8hAz0Tiow==",
      binary: "claude",
      sha256:
        "172150e3f9ea07e8e2e2e29862d7d9a25f5c234d8e909e4063df237665bf09b9",
    },
    commandMs: 30_000,
    managementMs: 90_000,
    guestCommandSeconds: 30,
  },
} as const;
export type HostPlatform = keyof typeof hostTargets;

/** ADR 0007: the owner's Mac is the only owner host. */
export const ownerHostRefusal =
  "The delivery controller runs only on macOS (darwin); this host is not supported.";
export function supportsOwnerHost(platform: unknown): boolean {
  return platform === "darwin";
}
export type HostTarget = (typeof hostTargets)[HostPlatform];

export function hostTarget(
  platform: unknown,
  arch?: unknown,
): HostTarget | undefined {
  const target = platform === "darwin" ? hostTargets.darwin : undefined;
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
/** The pinned Claude Code CLI for this host's guest, if it has one. */
export function claudeCodePin(
  platform: string,
  arch: string,
): HostTarget["claudeCode"] | undefined {
  return hostTarget(platform, arch)?.claudeCode;
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
