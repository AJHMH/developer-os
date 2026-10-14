#!/usr/bin/env node
import { NativeSyntheticTask } from "./synthetic-task.js";
import { NativeWindowsControls } from "./windows-controls.js";
import { NativeOnlineAccess } from "./online-native.js";
import { NpmArtifactRuntime } from "./npm-artifact.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DeliveryController, DeliveryError } from "./controller.js";
import { inspectLocalRepository } from "./onboarding.js";
import { SbxHostAdapter } from "./sbx-host.js";
import { PodmanHostAdapter } from "./podman-host.js";
import { NativePodmanDriver } from "./podman-native.js";
import { codexSubscriptionReader } from "./codex-usage.js";
import { authorizeSubscriptionAuth } from "./auth-host.js";
import { prepareSubscriptionAuth } from "./subscription-auth.js";
import { inspectSubscriptionAuth } from "./auth-status.js";

const usage =
  "Use start --repo <absolute-directory> --request <text>, status [--id <delivery-id>], qualification-report --id <delivery-id>, qualify/offline-canary/check-usage/poll-usage/pause/resume/cancel/recover/release --id <delivery-id>, or approve-usage --id <delivery-id> --check-id <usage-check-id>. Options: --state-dir <absolute-directory>, --owner-policy <external-file> for start, --codex-executable <absolute-host-executable> for usage checks. Enroll observed offline bindings with pin-offline --repo <absolute-directory> --podman-machine <aios-name> --worker-policy <new-external-file>. Supply the same machine/policy for native qualify/offline-canary/pause/cancel/recover. Use qualify-windows-controls or qualify-macos-controls --adversarial with the same machine/policy for signing/publication exclusion, mounts, descendant stopping and controller crash recovery. Use qualify --adversarial for disposable synthetic host/MCP and escape probes. --codex-executable also enables credential-free mediation inspection during qualify. Prepare non-secret external host registration with prepare-auth --repo <absolute-directory> --auth-directory <external-directory> [--state-dir <absolute-directory>]; Use authorize-auth with the same options for explicit browser consent and protected host-only storage on macOS or Windows x64, optionally selecting a saved --auth-account <identifier>; model-only VM mediation remains a separate prerequisite. Use auth-status with the same repo/state/auth-directory and a required --auth-account to inspect host-only eligibility before requesting inference approval; it performs no refresh and grants no inference authority. Use online-canary with the same machine/policy for fixed synthetic model/dependency access checks after positive mediation and usage approval. Add --dependency-policy <external-private-file> to admit one exact digest/size-pinned npm registry tarball; redirects, installs and host scripts are forbidden. qualification-report emits a read-only version-bound Windows or Mac worker report and never enables production. Use synthetic-task with the same machine/policy and --adversarial to edit the fixed admitted HTML fixture and validate inside isolation after independent host authentication qualification. Use --coding-minutes <1..1440> on start for the initial coding allowance (default 120). plan-feature/code-feature address an explicit --id; the CLI currently has no trusted feature planner or production coding adapter and refuses those dispatches. clarify-feature --id <id> --clarification <text> retains an explicit owner answer to material planning ambiguity. extend-coding --id <id> --minutes <1..1440> records an owner extension for stopped exhausted work. validate-baseline/validate-candidate --id <id> require an owner validation contract and trusted isolated validation adapter; no native validation executor is installed. Native execution is limited to fixed synthetic canaries and this disposable site task; production delivery remains disabled.";

function argumentsForCommand() {
  try {
    return parseArgs({
      allowPositionals: true,
      tokens: true,
      options: {
        "state-dir": { type: "string" },
        "owner-policy": { type: "string" },
        "codex-executable": { type: "string" },
        adversarial: { type: "boolean" },
        "auth-directory": { type: "string" },
        "auth-account": { type: "string" },
        "check-id": { type: "string" },
        "podman-machine": { type: "string" },
        "worker-policy": { type: "string" },
        "dependency-policy": { type: "string" },
        repo: { type: "string" },
        request: { type: "string" },
        issue: { type: "string" },
        "coding-minutes": { type: "string" },
        minutes: { type: "string" },
        clarification: { type: "string" },
        id: { type: "string" },
      },
    });
  } catch {
    throw new DeliveryError(usage);
  }
}

try {
  const { values, positionals, tokens } = argumentsForCommand();
  if (
    (values["podman-machine"] !== undefined ||
      values["worker-policy"] !== undefined) &&
    (![
      "qualify",
      "offline-canary",
      "online-canary",
      "synthetic-task",
      "qualify-windows-controls",
      "qualify-macos-controls",
      "pin-offline",
      "recover",
      "pause",
      "cancel",
    ].includes(positionals[0] ?? "") ||
      !values["podman-machine"] ||
      !/^aios-[a-z0-9-]+$/.test(values["podman-machine"]) ||
      values["worker-policy"] === "")
  )
    throw new DeliveryError(usage);
  if (
    values["dependency-policy"] !== undefined &&
    (positionals[0] !== "online-canary" ||
      !values["dependency-policy"] ||
      !values["podman-machine"] ||
      !values["worker-policy"])
  )
    throw new DeliveryError(usage);
  if (
    values["coding-minutes"] !== undefined &&
    (positionals[0] !== "start" ||
      !/^[1-9][0-9]{0,3}$/.test(values["coding-minutes"]) ||
      Number(values["coding-minutes"]) > 1440)
  )
    throw new DeliveryError(usage);
  if (
    values.minutes !== undefined &&
    (positionals[0] !== "extend-coding" ||
      !/^[1-9][0-9]{0,3}$/.test(values.minutes) ||
      Number(values.minutes) > 1440)
  )
    throw new DeliveryError(usage);
  if (
    values.clarification !== undefined &&
    positionals[0] !== "clarify-feature"
  )
    throw new DeliveryError(usage);
  const names = tokens
    .filter((token) => token.kind === "option")
    .map((token) => token.name);
  if (
    positionals.length !== 1 ||
    new Set(names).size !== names.length ||
    values["state-dir"] === ""
  )
    throw new DeliveryError(usage);
  const stateDirectory =
    values["state-dir"] ?? join(homedir(), ".developer-os");
  if (
    values.adversarial !== undefined &&
    (![
      "qualify",
      "synthetic-task",
      "qualify-windows-controls",
      "qualify-macos-controls",
    ].includes(positionals[0] ?? "") ||
      !values["podman-machine"] ||
      !values["worker-policy"])
  )
    throw new DeliveryError(usage);
  if (
    ["prepare-auth", "authorize-auth", "auth-status"].includes(
      positionals[0] ?? "",
    )
  ) {
    if (
      !values.repo ||
      !values["auth-directory"] ||
      names.some(
        (name) =>
          ![
            "repo",
            "state-dir",
            "auth-directory",
            ...(["authorize-auth", "auth-status"].includes(positionals[0]!)
              ? ["auth-account"]
              : []),
          ].includes(name),
      )
    )
      throw new DeliveryError(usage);
    if (positionals[0] === "auth-status" && !values["auth-account"])
      throw new DeliveryError(usage);
    if (
      values["auth-account"] !== undefined &&
      !/^[a-f0-9]{64}$/.test(values["auth-account"])
    )
      throw new DeliveryError(
        "The selected account must be the identifier returned by successful authorization.",
      );
    const prepared =
      positionals[0] === "auth-status"
        ? inspectSubscriptionAuth(
            values["auth-directory"],
            values.repo,
            stateDirectory,
            values["auth-account"]!,
          )
        : positionals[0] === "authorize-auth"
          ? await authorizeSubscriptionAuth(
              values["auth-directory"],
              values.repo,
              stateDirectory,
              (url) =>
                process.stdout.write(
                  `${JSON.stringify({ status: "awaiting-owner-consent", authorizationUrl: url, deliveryEnabled: false })}\n`,
                ),
              values["auth-account"],
            )
          : prepareSubscriptionAuth(
              values["auth-directory"],
              values.repo,
              stateDirectory,
            );
    process.stdout.write(`${JSON.stringify(prepared)}\n`);
    if (positionals[0] === "auth-status" && prepared.status !== "eligible")
      process.exitCode = 1;
  } else {
    if (
      values["auth-directory"] !== undefined ||
      values["auth-account"] !== undefined
    )
      throw new DeliveryError(usage);
    const native =
      values["podman-machine"] && values["worker-policy"]
        ? new NativePodmanDriver(
            values["podman-machine"],
            stateDirectory,
            values["worker-policy"],
          )
        : undefined;
    const synthetic =
      positionals[0] === "synthetic-task" && native
        ? new NativeSyntheticTask(native)
        : undefined;
    const controller = new DeliveryController(
      stateDirectory,
      {
        inspect: inspectLocalRepository,
        ...(values["owner-policy"] === undefined
          ? {}
          : { policyPath: values["owner-policy"] }),
      },
      {
        worker: values["podman-machine"]
          ? new PodmanHostAdapter({
              ...(values.adversarial ? { adversarial: true } : {}),
              ...(values["codex-executable"]
                ? { codexExecutable: values["codex-executable"] }
                : {}),
              machine: values["podman-machine"],
              ...(native ? { native } : {}),
              ...(values["worker-policy"]
                ? { policyPath: values["worker-policy"] }
                : {}),
            })
          : new SbxHostAdapter(),
        ...(native
          ? {
              offline: synthetic ?? native,
              ...([
                "qualify-windows-controls",
                "qualify-macos-controls",
              ].includes(positionals[0]!)
                ? { windowsControls: new NativeWindowsControls(native) }
                : {}),
              ...(synthetic ? { synthetic } : {}),
              online: values["dependency-policy"]
                ? new NpmArtifactRuntime(
                    new NativeOnlineAccess(native),
                    values["dependency-policy"],
                  )
                : new NativeOnlineAccess(native),
            }
          : {}),
        ...(values["codex-executable"]
          ? {
              subscription: codexSubscriptionReader(values["codex-executable"]),
            }
          : {}),
      },
    );
    let result;
    if (values["check-id"] !== undefined && positionals[0] !== "approve-usage")
      throw new DeliveryError(usage);
    if (
      positionals[0] === "pin-offline" &&
      native &&
      values.repo &&
      values.id === undefined &&
      values.request === undefined &&
      values.issue === undefined &&
      values["owner-policy"] === undefined &&
      values["codex-executable"] === undefined
    ) {
      result = native.pin(values.repo);
    } else if (
      positionals[0] === "start" &&
      values.repo &&
      values.request &&
      values.id === undefined
    ) {
      result = controller.start({
        repository: values.repo,
        request: values.request,
        ...(values.issue === undefined ? {} : { issue: values.issue }),
        ...(values["coding-minutes"] === undefined
          ? {}
          : { codingMinutes: Number(values["coding-minutes"]) }),
      });
    } else if (
      positionals[0] === "status" &&
      values.repo === undefined &&
      values.request === undefined &&
      values.issue === undefined &&
      values["owner-policy"] === undefined
    ) {
      result =
        values.id === undefined
          ? controller.list()
          : controller.status(values.id);
    } else {
      if (positionals[0] === "clarify-feature") {
        if (
          !values.id ||
          !values.clarification ||
          values.repo !== undefined ||
          values.request !== undefined ||
          values.issue !== undefined ||
          values["owner-policy"] !== undefined
        )
          throw new DeliveryError(usage);
        result = await controller.clarifyFeature(
          values.id,
          values.clarification,
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exit(0);
      }
      if (positionals[0] === "extend-coding") {
        if (
          !values.id ||
          !values.minutes ||
          values.repo !== undefined ||
          values.request !== undefined ||
          values.issue !== undefined ||
          values["owner-policy"] !== undefined
        )
          throw new DeliveryError(usage);
        result = controller.extendCoding(values.id, Number(values.minutes));
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exit(0);
      }
      const command =
        positionals[0] === "validate-baseline"
          ? "validateBaseline"
          : positionals[0] === "validate-candidate"
            ? "validateCandidate"
            : positionals[0] === "plan-feature"
              ? "planFeature"
              : positionals[0] === "code-feature"
                ? "codeFeature"
                : positionals[0] === "qualify-windows-controls"
                  ? "qualifyWindowsControls"
                  : positionals[0] === "qualify-macos-controls"
                    ? "qualifyMacosControls"
                    : positionals[0] === "synthetic-task"
                      ? "syntheticTask"
                      : positionals[0] === "check-usage"
                        ? "checkUsage"
                        : positionals[0] === "poll-usage"
                          ? "pollUsage"
                          : positionals[0] === "offline-canary"
                            ? "offlineCanary"
                            : positionals[0] === "online-canary"
                              ? "onlineCanary"
                              : positionals[0] === "qualification-report"
                                ? "qualificationReport"
                                : positionals[0];
      if (
        command === "approve-usage" &&
        values.id &&
        values["check-id"] &&
        values.repo === undefined &&
        values.request === undefined &&
        values.issue === undefined &&
        values["owner-policy"] === undefined
      ) {
        result = controller.approveUsage(values.id, values["check-id"]);
      } else if (
        values.id &&
        values.repo === undefined &&
        values.request === undefined &&
        values.issue === undefined &&
        values["owner-policy"] === undefined &&
        (command === "validateBaseline" ||
          command === "validateCandidate" ||
          command === "planFeature" ||
          command === "codeFeature" ||
          command === "checkUsage" ||
          command === "qualificationReport" ||
          command === "pollUsage" ||
          command === "qualify" ||
          command === "offlineCanary" ||
          command === "syntheticTask" ||
          command === "qualifyWindowsControls" ||
          command === "qualifyMacosControls" ||
          command === "onlineCanary" ||
          command === "pause" ||
          command === "resume" ||
          command === "cancel" ||
          command === "recover" ||
          command === "release")
      ) {
        result = await controller[command](values.id);
      } else throw new DeliveryError(usage);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof DeliveryError ? error.message : "Unable to access the repository or delivery state. Check local paths and permissions." })}\n`,
  );
  process.exitCode = 1;
}
