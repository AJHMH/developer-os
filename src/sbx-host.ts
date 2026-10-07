import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type {
  WorkerAdapter,
  WorkerSession,
  WorkerReceipt,
} from "./controller.js";
import {
  unavailableQualification,
  type WorkerQualification,
} from "./qualification.js";

/** Host diagnostics are prerequisite observations, never sandbox qualification.
 * The executable is selected from installation locations, not a candidate PATH.
 * Output is bounded and projected onto fixed fields; diagnostic details are discarded. */
function diagnose(): string {
  const candidates =
    process.platform === "win32"
      ? [
          join(
            process.env.LOCALAPPDATA ?? "",
            "DockerSandboxes",
            "bin",
            "sbx.exe",
          ),
          join(
            process.env.ProgramFiles ?? "",
            "DockerSandboxes",
            "bin",
            "sbx.exe",
          ),
        ].filter((path) => /^[A-Za-z]:\\/.test(path))
      : process.platform === "darwin"
        ? ["/opt/homebrew/bin/sbx", "/usr/local/bin/sbx"]
        : [];
  const executable = candidates.find(existsSync);
  if (!executable) throw Error("Runtime unavailable");
  const result = spawnSync(executable, ["diagnose", "--json"], {
    cwd:
      process.platform === "win32"
        ? (process.env.SystemRoot ?? "C:\\Windows")
        : "/",
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 256 * 1024,
    shell: false,
    windowsHide: true,
  });
  // Diagnose exits nonzero for failed checks but still provides structured observations.
  if (result.error || result.signal || result.status === null)
    throw Error("Runtime unavailable");
  return result.stdout;
}

export class SbxHostAdapter implements WorkerAdapter {
  constructor(private readonly observeHost: () => string = diagnose) {}
  async probe(): Promise<WorkerQualification> {
    const report = unavailableQualification();
    const host: NonNullable<WorkerQualification["host"]> = {
      virtualization: "unknown",
      daemon: "unknown",
      authentication: "unknown",
    };
    report.host = host;
    try {
      const document = JSON.parse(this.observeHost()) as {
        version?: unknown;
        checks?: unknown;
      };
      if (document.version !== "1.0" || !Array.isArray(document.checks))
        throw Error("Unknown diagnostics");
      const checks = document.checks as {
        name?: unknown;
        status?: unknown;
        message?: unknown;
      }[];
      const fact = (name: string) => {
        const matching = checks.filter((check) => check && check.name === name);
        if (matching.length !== 1) return "unknown" as const;
        return matching[0]?.status === "pass"
          ? ("verified" as const)
          : matching[0]?.status === "fail"
            ? ("conflicting" as const)
            : ("unknown" as const);
      };
      host.virtualization = fact("Virtualization");
      host.daemon = fact("Daemon");
      host.authentication = fact("Authentication");
      const versions = checks.filter(
        (check) => check && check.name === "Binary version",
      );
      const version =
        versions.length === 1 && versions[0]?.status === "pass"
          ? versions[0].message
          : undefined;
      if (typeof version === "string" && /^v\d+\.\d+\.\d+$/.test(version))
        host.sbxVersion = version.slice(1);
    } catch {
      /* Preserve unknown; never retain diagnostic error text. */
    }
    if (!host.sbxVersion)
      report.blockers.push(
        "Install Docker Sandboxes and verify its CLI version.",
      );
    if (host.virtualization !== "verified")
      report.blockers.push(
        "Enable and verify supported host virtualization before creating sandboxes.",
      );
    if (host.daemon !== "verified")
      report.blockers.push(
        "Resolve Docker Sandboxes daemon startup and rerun sbx diagnose --json.",
      );
    if (host.authentication !== "verified")
      report.blockers.push(
        "Run sbx login and verify Docker authentication with the daemon available.",
      );
    return report;
  }
  qualified(): boolean {
    return false;
  }
  async start(): Promise<WorkerReceipt> {
    throw Error("Native worker isolation is not qualified");
  }
  async fenceAndStop(session: WorkerSession): Promise<WorkerReceipt> {
    return { ...session, status: "unknown" };
  }
}
