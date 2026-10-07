#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DeliveryController, DeliveryError } from "./controller.js";
import { inspectLocalRepository } from "./onboarding.js";

const usage =
  "Use start --repo <absolute-directory> --request <text> [--issue <reference>] [--owner-policy <external-file>], or status [--id <delivery-id>], with optional --state-dir <directory>.";

function argumentsForCommand() {
  try {
    return parseArgs({
      allowPositionals: true,
      tokens: true,
      options: {
        "state-dir": { type: "string" },
        "owner-policy": { type: "string" },
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
  );
  let result;
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
    throw new DeliveryError(usage);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof DeliveryError ? error.message : "Unable to access the repository or delivery state. Check local paths and permissions." })}\n`,
  );
  process.exitCode = 1;
}
