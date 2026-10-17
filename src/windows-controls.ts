import { readFileSync } from "node:fs";
import type { Delivery } from "./controller.js";
import { sha256, type CanaryPins } from "./offline-canary.js";
export const hostControlsVersion = sha256(
  Buffer.concat([
    readFileSync(new URL(import.meta.url)),
    // The integration exercise still observes controller phase/ownership guards.
    // Retain this conservative pin until those semantics have their own boundary.
    readFileSync(new URL("./controller.js", import.meta.url)),
    readFileSync(new URL("./session-lifecycle.js", import.meta.url)),
    readFileSync(new URL("./podman-host.js", import.meta.url)),
    readFileSync(new URL("./host-controls-exercise.js", import.meta.url)),
    readFileSync(new URL("./vm-management.js", import.meta.url)),
    readFileSync(new URL("./host-target.js", import.meta.url)),
  ]),
);
export const hostControlNames = [
  "ssh-gpg",
  "github-binding",
  "effective-mounts",
  "descendant-stop",
  "repository-fencing",
  "orphan-resume",
] as const;
export interface HostControlsEvidence extends CanaryPins {
  version: string;
  nativeVersion: string;
  mode: "live" | "controlled";
  operationId: string;
  outcome: "passed";
  checks: {
    name: (typeof hostControlNames)[number];
    evidenceSha256: string;
  }[];
  censuses: {
    observedProcesses: number;
    remainingProcesses: number;
    censusSha256: string;
  }[];
  productionEnabled: false;
}
export interface HostControlsRuntime {
  readonly version: string;
  readonly mode: "live" | "controlled";
  qualify(delivery: Delivery): Promise<HostControlsEvidence>;
}

// Legacy evidence names remain valid; the implementation is target-neutral.
export {
  hostControlNames as windowsControlNames,
  hostControlsVersion as windowsControlsVersion,
};
export type WindowsControlsEvidence = HostControlsEvidence;
export type WindowsControlsRuntime = HostControlsRuntime;
