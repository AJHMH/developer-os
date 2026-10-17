import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export interface QualificationRuntimeVersions {
  worker: string;
  online: string;
  artifact: string;
  verification: string;
}
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
/** Measured when qualification is produced, not during report projection. */
export function stampQualificationVersions(): QualificationRuntimeVersions {
  const read = (name: string) =>
    readFileSync(new URL(`./${name}.js`, import.meta.url));
  const online = digest(read("online-native"));
  return {
    worker: digest(read("podman-native")),
    online,
    artifact: digest(read("npm-artifact") + "\n" + online),
    verification: digest(
      Buffer.concat(
        [
          "qualification-rules",
          "host-target",
          "vm-management",
          "windows-controls",
          "host-controls-exercise",
          "session-lifecycle",
          "subscription",
          "subscription-account",
          "private-storage",
          "inference-contract",
          "gateway-canary",
          "codex-app-server",
          "path-containment",
        ].map(read),
      ),
    ),
  };
}
/** The code loaded by this process is the reference for its retained reports. */
export const qualificationRuntimeVersions = Object.freeze(
  stampQualificationVersions(),
);
export function qualificationVersionsMatch(
  value: QualificationRuntimeVersions | undefined,
): boolean {
  return Boolean(
    value &&
      Object.entries(qualificationRuntimeVersions).every(
        ([name, pin]) =>
          value[name as keyof QualificationRuntimeVersions] === pin,
      ),
  );
}
