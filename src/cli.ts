#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { authorizeSubscriptionAuth } from "./auth-host.js";
import { inspectSubscriptionAuth } from "./auth-status.js";
import { cliOptions, validateCliCommand } from "./cli-commands.js";
import { codexSubscriptionReader } from "./codex-usage.js";
import { DeliveryController, DeliveryError } from "./controller.js";
import { NativeHostControls } from "./host-controls-exercise.js";
import { NpmArtifactRuntime } from "./npm-artifact.js";
import { inspectLocalRepository } from "./onboarding.js";
import { NativeOnlineAccess } from "./online-native.js";
import { PodmanHostAdapter } from "./podman-host.js";
import { NativePodmanDriver } from "./podman-native.js";
import { prepareSubscriptionAuth } from "./subscription-auth.js";
import { NativeSyntheticTask } from "./synthetic-task.js";
import { nativeCodingRuntime } from "./native-coding-runtime.js";
import { ownerCriteriaPlanner } from "./feature-criteria.js";

const usage =
  "Use start --repo <absolute-directory> --request <text>, status [--id <delivery-id>], qualification-report --id <delivery-id>, qualify/offline-canary/check-usage/poll-usage/pause/resume/cancel/recover/release --id <delivery-id>, or approve-usage --id <delivery-id> --check-id <usage-check-id>. Options: --state-dir <absolute-directory>, --owner-policy <external-file> for start, validate-baseline, validate-candidate and code-feature, with optional --onboarding-attestation <owner-record> for the onboarding facts the CLI cannot observe (attested, never live verification; ADR 0004), --codex-executable <absolute-host-executable> for usage checks. Enroll observed offline bindings with pin-offline --repo <absolute-directory> --podman-machine <aios-name> --worker-policy <new-external-file>. Supply the same machine/policy for native qualify/offline-canary/pause/cancel/recover. Add --coding-admission <owner-record> to pause/cancel/recover to also stop or recover the exact native coding session through the owner-admitted pins. Use qualify-windows-controls or qualify-macos-controls --adversarial with the same machine/policy for signing/publication exclusion, mounts, descendant stopping and controller crash recovery. Use qualify --adversarial for disposable synthetic host/MCP and escape probes. --codex-executable also enables credential-free mediation inspection during qualify. Prepare non-secret external host registration with prepare-auth --repo <absolute-directory> --auth-directory <external-directory> [--state-dir <absolute-directory>]; Use authorize-auth with the same options for explicit browser consent and protected host-only storage on macOS or Windows x64, optionally selecting a saved --auth-account <identifier>; model-only VM mediation remains a separate prerequisite. Use auth-status with the same repo/state/auth-directory and a required --auth-account to inspect host-only eligibility before requesting inference approval; it performs no refresh and grants no inference authority. Use online-canary with the same machine/policy for fixed synthetic model/dependency access checks after positive mediation and usage approval. Add --dependency-policy <external-private-file> to admit one exact digest/size-pinned npm registry tarball; redirects, installs and host scripts are forbidden. qualification-report emits a read-only version-bound Windows or Mac worker report and never enables production. Use synthetic-task with the same machine/policy and --adversarial to edit the fixed admitted HTML fixture and validate inside isolation after independent host authentication qualification. Use --coding-minutes <1..1440> on start for the initial coding allowance (default 120). plan-feature/code-feature address an explicit --id. plan-feature and clarify-feature take --feature-criteria <owner-file>: the owner's private criteria for this delivery's exact request and clarifications (ADR 0004); without it planning refuses. The CLI has no production coding adapter and refuses code-feature dispatch. clarify-feature --id <id> --clarification <text> retains an explicit owner answer to material planning ambiguity. extend-coding --id <id> --minutes <1..1440> records an owner extension for stopped exhausted work. validate-baseline/validate-candidate --id <id> require an owner validation contract and trusted isolated validation adapter; no native validation executor is installed. repair-feature --id <id> repairs a failed candidate within three cycles or 60 active minutes, including local revalidation. extend-repair --id <id> [--cycles <0..100>] [--minutes <0..1440>] records an explicit owner extension for stopped exhausted repairs. publish-feature/reconcile-publication --id <id> require qualified controlled signing/publication and separate App PR adapters; no native publisher is installed. monitor-pr-checks/repair-pr-checks --id <id> and rerun-pr-check --id <id> --check-id <id> require a trusted controlled PR check adapter; no native monitor is installed. monitor-review/repair-review --id <id> and resolve-review-thread --id <id> --thread-id <id> require a trusted controlled review adapter; no native reviewer is installed. merge-feature/reconcile-merge/refresh-merge-base --id <id> require controlled conditional merge authority; no native merge adapter is installed. monitor-main-checks --id <id> observes trusted checks for the confirmed merged/main revision; no native main observer is installed. sync-main/reconcile-main-sync --id <id> require fresh trusted main checks and a controlled conditional Git adapter; no native synchronization adapter is installed. cleanup-branches/reconcile-cleanup --id <id> require synchronized verified main and controlled conditional branch authority; no native cleanup adapter is installed. Native execution is limited to fixed synthetic canaries and this disposable site task; production delivery remains disabled.";

function argumentsForCommand() {
  try {
    return parseArgs({
      allowPositionals: true,
      tokens: true,
      options: cliOptions,
    });
  } catch {
    throw new DeliveryError(usage);
  }
}
try {
  const { values, positionals, tokens } = argumentsForCommand();
  const invocation = validateCliCommand(
    positionals,
    values,
    tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name),
  );
  if ("error" in invocation)
    throw new DeliveryError(
      invocation.error === "account"
        ? "The selected account must be the identifier returned by successful authorization."
        : usage,
    );
  const { command } = invocation,
    stateDirectory = values["state-dir"] ?? join(homedir(), ".developer-os");
  let result;
  if (command.kind === "auth") {
    const actions = {
      status: () =>
        inspectSubscriptionAuth(
          values["auth-directory"]!,
          values.repo!,
          stateDirectory,
          values["auth-account"]!,
        ),
      prepare: () =>
        prepareSubscriptionAuth(
          values["auth-directory"]!,
          values.repo!,
          stateDirectory,
        ),
      authorize: () =>
        authorizeSubscriptionAuth(
          values["auth-directory"]!,
          values.repo!,
          stateDirectory,
          (url) =>
            process.stdout.write(
              `${JSON.stringify({ status: "awaiting-owner-consent", authorizationUrl: url, deliveryEnabled: false })}\n`,
            ),
          values["auth-account"],
        ),
    };
    const prepared = await actions[command.authAction!]();
    result = prepared;
    if (command.authAction === "status" && prepared.status !== "eligible")
      process.exitCode = 1;
  } else {
    const native =
      command.runtimes.includes("native") &&
      values["podman-machine"] &&
      values["worker-policy"]
        ? new NativePodmanDriver(
            values["podman-machine"],
            stateDirectory,
            values["worker-policy"],
          )
        : undefined;
    const synthetic =
      command.runtimes.includes("synthetic") && native
        ? new NativeSyntheticTask(native)
        : undefined;
    let featureRuntime;
    if (values["coding-admission"])
      try {
        featureRuntime = nativeCodingRuntime(
          values["podman-machine"]!,
          values["coding-admission"],
        );
      } catch {
        throw new DeliveryError(
          "The owner coding admission record is missing or invalid, or does not admit valid coding pins. Production remains disabled.",
        );
      }
    const controller = new DeliveryController(
      stateDirectory,
      {
        inspect: inspectLocalRepository,
        ...(values["owner-policy"] === undefined
          ? {}
          : { policyPath: values["owner-policy"] }),
        ...(values["onboarding-attestation"] === undefined
          ? {}
          : { attestationPath: values["onboarding-attestation"] }),
      },
      {
        ...(values["podman-machine"]
          ? {
              worker: new PodmanHostAdapter({
                ...(values.adversarial ? { adversarial: true } : {}),
                ...(values["codex-executable"]
                  ? { codexExecutable: values["codex-executable"] }
                  : {}),
                machine: values["podman-machine"],
                ...(native ? { native } : {}),
                ...(values["worker-policy"]
                  ? { policyPath: values["worker-policy"] }
                  : {}),
              }),
            }
          : {}),
        ...(native
          ? {
              offline: synthetic ?? native,
              ...(command.runtimes.includes("controls")
                ? { windowsControls: new NativeHostControls(native) }
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
        ...(featureRuntime ? { featureRuntime } : {}),
        ...(values["feature-criteria"]
          ? {
              featurePlanner: ownerCriteriaPlanner(
                values["feature-criteria"],
                values.id!,
              ),
            }
          : {}),
        ...(command.runtimes.includes("subscription") &&
        values["codex-executable"]
          ? {
              subscription: codexSubscriptionReader(values["codex-executable"]),
            }
          : {}),
      },
    );
    if (command.kind === "pin") {
      if (!native) throw new DeliveryError(usage);
      result = native.pin(values.repo!);
    } else {
      if (!command.invoke) throw new DeliveryError(usage);
      result = await command.invoke(controller, values);
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof DeliveryError ? error.message : "Unable to access the repository or delivery state. Check local paths and permissions." })}\n`,
  );
  process.exitCode = 1;
}
