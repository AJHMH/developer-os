import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const names = [
  "hostBinding",
  "offlineTransfer",
  "adversarialIsolation",
  "onlinePolicy",
  "authentication",
  "usageGate",
  "fencingRecovery",
  "syntheticTask",
  "isolatedValidation",
];
/** Completion is a qualified public report plus independently stopped sessions. */
export function assertWindowsAcceptance(report, delivery) {
  if (
    report?.outcome !== "qualified" ||
    report.productionEnabled !== false ||
    report.deliveryId !== delivery?.id ||
    report.target?.platform !== "win32" ||
    report.target?.arch !== "x64" ||
    report.target?.provider !== "hyperv" ||
    Object.keys(report.checks ?? {}).length !== names.length ||
    names.some(
      (name) =>
        report.checks?.[name]?.result !== "passed" ||
        report.checks[name].evidenceMode !== "live",
    ) ||
    delivery.execution?.state !== "stopped" ||
    delivery.onlineAccess?.state !== "stopped" ||
    (delivery.sessions ?? []).some((session) => session.state !== "stopped") ||
    (delivery.onlineRuns ?? []).some((run) => run.state !== "stopped")
  )
    throw Error("Windows acceptance incomplete");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values, positionals, tokens } = parseArgs({
      options: { "state-dir": { type: "string" }, id: { type: "string" } },
      allowPositionals: true,
      tokens: true,
    });
    if (
      !values.id ||
      !values["state-dir"] ||
      positionals.length ||
      tokens.filter((t) => t.kind === "option").length !== 2
    )
      throw Error();
    const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
    const read = (command) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [cli, command, "--id", values.id, "--state-dir", values["state-dir"]],
          {
            encoding: "utf8",
            timeout: 30000,
            maxBuffer: 1048576,
            stdio: ["ignore", "pipe", "inherit"],
          },
        ),
      );
    const report = read("qualification-report");
    assertWindowsAcceptance(report, read("status"));
    console.log(JSON.stringify(report));
  } catch {
    console.error(
      JSON.stringify({
        status: "refused",
        reason: "windows-acceptance-incomplete",
        productionEnabled: false,
      }),
    );
    process.exitCode = 1;
  }
}
