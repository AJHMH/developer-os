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
      /** The worker image: Docker's official bash image,
       * bash:5.3.15-alpine3.24 (Alpine 3.24.1, built 2026-06-16), by its arm64
       * manifest digest. Claude Code's Bash tool needs bash or zsh; bash is
       * /usr/local/bin/bash there. */
      template:
        "docker.io/library/bash@sha256:826e424f395d3d1e10adc155e63f3c69090c5559c5f3914b0d4c9064e767b06a",
      /** The image's exact environment, which the guest checks. */
      imageEnv: Object.freeze([
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "_BASH_VERSION=5.3.15",
        "_BASH_BASELINE=5.3",
        "_BASH_LATEST_PATCH=15",
      ]),
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
export function claudeCodeTemplate(
  platform: string,
  arch: string,
): string | undefined {
  return claudeCodePin(platform, arch)?.template;
}
export function claudeCodePin(
  platform: string,
  arch: string,
): HostTarget["claudeCode"] | undefined {
  return hostTarget(platform, arch)?.claudeCode;
}
