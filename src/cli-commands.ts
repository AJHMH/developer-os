import type { DeliveryController } from "./controller.js";
export const cliOptions = {
  "state-dir": { type: "string" },
  "owner-policy": { type: "string" },
  "codex-executable": { type: "string" },
  adversarial: { type: "boolean" },
  "auth-directory": { type: "string" },
  "auth-account": { type: "string" },
  "check-id": { type: "string" },
  "thread-id": { type: "string" },
  "podman-machine": { type: "string" },
  "worker-policy": { type: "string" },
  "dependency-policy": { type: "string" },
  "coding-admission": { type: "string" },
  repo: { type: "string" },
  request: { type: "string" },
  issue: { type: "string" },
  "coding-minutes": { type: "string" },
  minutes: { type: "string" },
  cycles: { type: "string" },
  clarification: { type: "string" },
  id: { type: "string" },
} as const;
export type CliOptionName = keyof typeof cliOptions;
export type CliValues = {
  [Name in Exclude<CliOptionName, "adversarial">]?: string | undefined;
} & { adversarial?: boolean | undefined };
type Runtime = "native" | "synthetic" | "controls" | "subscription";
export interface CliCommand {
  kind: "delivery" | "auth" | "pin";
  required: readonly CliOptionName[];
  optional: readonly CliOptionName[];
  runtimes: readonly Runtime[];
  invoke?: (
    controller: DeliveryController,
    values: CliValues,
  ) => unknown | Promise<unknown>;
  authAction?: "prepare" | "authorize" | "status";
}
type IdAction = {
  [Key in keyof DeliveryController]: DeliveryController[Key] extends (
    id: string,
  ) => unknown
    ? Key
    : never;
}[keyof DeliveryController];
const nativeOptions = ["podman-machine", "worker-policy"] as const;
function idAction(
  method: IdAction,
  optional: readonly CliOptionName[] = [],
  runtimes: readonly Runtime[] = [],
): CliCommand {
  return {
    kind: "delivery",
    required: ["id"],
    optional,
    runtimes,
    invoke: (controller, values) => controller[method](values.id!),
  };
}
const commands: Record<string, CliCommand> = {
  start: {
    kind: "delivery",
    required: ["repo", "request"],
    optional: ["issue", "coding-minutes", "owner-policy"],
    runtimes: [],
    invoke: (c, v) =>
      c.start({
        repository: v.repo!,
        request: v.request!,
        ...(v.issue === undefined ? {} : { issue: v.issue }),
        ...(v["coding-minutes"] === undefined
          ? {}
          : { codingMinutes: Number(v["coding-minutes"]) }),
      }),
  },
  status: {
    kind: "delivery",
    required: [],
    optional: ["id"],
    runtimes: [],
    invoke: (c, v) => (v.id === undefined ? c.list() : c.status(v.id)),
  },
  "pin-offline": {
    kind: "pin",
    required: ["repo", ...nativeOptions],
    optional: [],
    runtimes: ["native"],
  },
  "prepare-auth": {
    kind: "auth",
    authAction: "prepare",
    required: ["repo", "auth-directory"],
    optional: [],
    runtimes: [],
  },
  "authorize-auth": {
    kind: "auth",
    authAction: "authorize",
    required: ["repo", "auth-directory"],
    optional: ["auth-account"],
    runtimes: [],
  },
  "auth-status": {
    kind: "auth",
    authAction: "status",
    required: ["repo", "auth-directory", "auth-account"],
    optional: [],
    runtimes: [],
  },
  qualify: idAction(
    "qualify",
    [...nativeOptions, "codex-executable", "adversarial"],
    ["native", "subscription"],
  ),
  "offline-canary": idAction("offlineCanary", nativeOptions, ["native"]),
  "online-canary": idAction(
    "onlineCanary",
    [...nativeOptions, "codex-executable", "dependency-policy"],
    ["native", "subscription"],
  ),
  "synthetic-task": idAction(
    "syntheticTask",
    [...nativeOptions, "adversarial"],
    ["native", "synthetic"],
  ),
  "qualify-windows-controls": idAction(
    "qualifyWindowsControls",
    [...nativeOptions, "adversarial"],
    ["native", "controls"],
  ),
  "qualify-macos-controls": idAction(
    "qualifyMacosControls",
    [...nativeOptions, "adversarial"],
    ["native", "controls"],
  ),
  "qualification-report": idAction("qualificationReport"),
  "check-usage": idAction("checkUsage", ["codex-executable"], ["subscription"]),
  "poll-usage": idAction(
    "pollUsage",
    [...nativeOptions, "codex-executable"],
    ["native", "subscription"],
  ),
  // With an owner coding admission, these also stop or recover the exact
  // native coding session.
  pause: idAction("pause", [...nativeOptions, "coding-admission"], ["native"]),
  cancel: idAction(
    "cancel",
    [...nativeOptions, "coding-admission"],
    ["native"],
  ),
  recover: idAction(
    "recover",
    [...nativeOptions, "coding-admission"],
    ["native"],
  ),
  resume: idAction("resume"),
  release: idAction("release"),
  "plan-feature": idAction("planFeature"),
  "code-feature": idAction("codeFeature"),
  "validate-baseline": idAction("validateBaseline"),
  "validate-candidate": idAction("validateCandidate"),
  "repair-feature": idAction("repairFeature"),
  "publish-feature": idAction("publishFeature"),
  "reconcile-publication": idAction("reconcilePublication"),
  "monitor-pr-checks": idAction("monitorPRChecks"),
  "repair-pr-checks": idAction("repairPRChecks"),
  "monitor-review": idAction("monitorReview"),
  "repair-review": idAction("repairReview"),
  "merge-feature": idAction("mergeFeature"),
  "reconcile-merge": idAction("reconcileMerge"),
  "refresh-merge-base": idAction("refreshMergeBase"),
  "monitor-main-checks": idAction("monitorMainChecks"),
  "sync-main": idAction("syncMain"),
  "reconcile-main-sync": idAction("reconcileMainSync"),
  "cleanup-branches": idAction("cleanupBranches"),
  "reconcile-cleanup": idAction("reconcileCleanup"),
  "approve-usage": {
    kind: "delivery",
    required: ["id", "check-id"],
    optional: [],
    runtimes: [],
    invoke: (c, v) => c.approveUsage(v.id!, v["check-id"]!),
  },
  "rerun-pr-check": {
    kind: "delivery",
    required: ["id", "check-id"],
    optional: [],
    runtimes: [],
    invoke: (c, v) => c.rerunPRCheck(v.id!, v["check-id"]!),
  },
  "resolve-review-thread": {
    kind: "delivery",
    required: ["id", "thread-id"],
    optional: [],
    runtimes: [],
    invoke: (c, v) => c.resolveReviewThread(v.id!, v["thread-id"]!),
  },
  "clarify-feature": {
    kind: "delivery",
    required: ["id", "clarification"],
    optional: [],
    runtimes: [],
    invoke: (c, v) => c.clarifyFeature(v.id!, v.clarification!),
  },
  "extend-coding": {
    kind: "delivery",
    required: ["id", "minutes"],
    optional: [],
    runtimes: [],
    invoke: (c, v) => c.extendCoding(v.id!, Number(v.minutes)),
  },
  "extend-repair": {
    kind: "delivery",
    required: ["id"],
    optional: ["minutes", "cycles"],
    runtimes: [],
    invoke: (c, v) =>
      c.extendRepair(v.id!, Number(v.cycles ?? 0), Number(v.minutes ?? 0)),
  },
};
export const cliCommands = Object.freeze(
  Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      Object.freeze({
        ...command,
        required: Object.freeze([...command.required]),
        optional: Object.freeze([...command.optional]),
        runtimes: Object.freeze([...command.runtimes]),
      }),
    ]),
  ),
);
export function validateCliCommand(
  positionals: readonly string[],
  values: CliValues,
  names: readonly string[],
): { command: CliCommand; name: string } | { error: "arguments" | "account" } {
  const name = positionals[0],
    command = name === undefined ? undefined : cliCommands[name];
  if (
    !name ||
    !command ||
    positionals.length !== 1 ||
    new Set(names).size !== names.length ||
    values["state-dir"] === ""
  )
    return { error: "arguments" };
  const allowed: readonly string[] = [
    "state-dir",
    ...command.required,
    ...command.optional,
  ];
  if (
    names.some((option) => !allowed.includes(option)) ||
    command.required.some((option) => !values[option])
  )
    return { error: "arguments" };
  if (
    values["auth-account"] !== undefined &&
    !/^[a-f0-9]{64}$/.test(values["auth-account"])
  )
    return { error: "account" };
  if (
    (values["podman-machine"] !== undefined ||
      values["worker-policy"] !== undefined) &&
    (!values["podman-machine"] ||
      !/^aios-[a-z0-9-]+$/.test(values["podman-machine"]) ||
      values["worker-policy"] === "")
  )
    return { error: "arguments" };
  if (
    values.adversarial !== undefined &&
    (!values["podman-machine"] || !values["worker-policy"])
  )
    return { error: "arguments" };
  if (
    values["dependency-policy"] !== undefined &&
    (!values["dependency-policy"] ||
      !values["podman-machine"] ||
      !values["worker-policy"])
  )
    return { error: "arguments" };
  if (
    values["coding-admission"] !== undefined &&
    (!values["coding-admission"] || !values["podman-machine"])
  )
    return { error: "arguments" };
  if (
    values["coding-minutes"] !== undefined &&
    (!/^[1-9][0-9]{0,3}$/.test(values["coding-minutes"]) ||
      Number(values["coding-minutes"]) > 1440)
  )
    return { error: "arguments" };
  if (
    values.minutes !== undefined &&
    (!(
      name === "extend-repair" ? /^(0|[1-9][0-9]{0,3})$/ : /^[1-9][0-9]{0,3}$/
    ).test(values.minutes) ||
      Number(values.minutes) > 1440)
  )
    return { error: "arguments" };
  if (
    values.cycles !== undefined &&
    (!/^(0|[1-9][0-9]{0,2})$/.test(values.cycles) ||
      Number(values.cycles) > 100)
  )
    return { error: "arguments" };
  if (
    name === "extend-repair" &&
    values.minutes === undefined &&
    values.cycles === undefined
  )
    return { error: "arguments" };
  return { name, command };
}
