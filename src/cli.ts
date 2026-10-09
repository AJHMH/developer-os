#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DeliveryController, DeliveryError } from "./controller.js";
import { inspectLocalRepository } from "./onboarding.js";
import { SbxHostAdapter } from "./sbx-host.js";
import { PodmanHostAdapter } from "./podman-host.js";
import { codexSubscriptionReader } from "./codex-usage.js";

const usage =
  "Use start --repo <absolute-directory> --request <text>, status [--id <delivery-id>], qualify/offline-canary/check-usage/poll-usage/pause/resume/cancel/recover/release --id <delivery-id>, or approve-usage --id <delivery-id> --check-id <usage-check-id>. Options: --state-dir <directory>, --owner-policy <external-file> for start, --codex-executable <absolute-host-executable> for usage checks; qualify/offline-canary --podman-machine <aios-name> [--worker-policy <external-pin-file>] requires offline prerequisites; native canary dispatch remains disabled until a trusted VM management driver is available.";

function argumentsForCommand() {
  try {
    return parseArgs({
      allowPositionals: true,
      tokens: true,
      options: {
        "state-dir": { type: "string" },
        "owner-policy": { type: "string" },
        "codex-executable": { type: "string" },
        "check-id": { type: "string" },
        "podman-machine": { type: "string" },
        "worker-policy": { type: "string" },
        repo: { type: "string" },
        request: { type: "string" },
        issue: { type: "string" },
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
    (!["qualify", "offline-canary"].includes(positionals[0] ?? "") ||
      !values["podman-machine"] ||
      !/^aios-[a-z0-9-]+$/.test(values["podman-machine"]) ||
      values["worker-policy"] === "")
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
  const controller = new DeliveryController(
    values["state-dir"] ?? join(homedir(), ".developer-os"),
    {
      inspect: inspectLocalRepository,
      ...(values["owner-policy"] === undefined
        ? {}
        : { policyPath: values["owner-policy"] }),
    },
    {
      worker: values["podman-machine"]
        ? new PodmanHostAdapter({
            machine: values["podman-machine"],
            ...(values["worker-policy"]
              ? { policyPath: values["worker-policy"] }
              : {}),
          })
        : new SbxHostAdapter(),
      ...(values["codex-executable"]
        ? { subscription: codexSubscriptionReader(values["codex-executable"]) }
        : {}),
    },
  );
  let result;
  if (values["check-id"] !== undefined && positionals[0] !== "approve-usage")
    throw new DeliveryError(usage);
  if (
    positionals[0] === "start" &&
    values.repo &&
    values.request &&
    values.id === undefined
  ) {
    result = controller.start({
      repository: values.repo,
      request: values.request,
      ...(values.issue === undefined ? {} : { issue: values.issue }),
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
    const command =
      positionals[0] === "check-usage"
        ? "checkUsage"
        : positionals[0] === "poll-usage"
          ? "pollUsage"
          : positionals[0] === "offline-canary"
            ? "offlineCanary"
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
      (command === "checkUsage" ||
        command === "pollUsage" ||
        command === "qualify" ||
        command === "offlineCanary" ||
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
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof DeliveryError ? error.message : "Unable to access the repository or delivery state. Check local paths and permissions." })}\n`,
  );
  process.exitCode = 1;
}
