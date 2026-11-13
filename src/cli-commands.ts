import type { DeliveryController } from "./controller.js";
export const cliOptions = {
  "state-dir": { type: "string" },
  "owner-policy": { type: "string" },
  replace: { type: "boolean" },
  "auth-directory": { type: "string" },
  "check-id": { type: "string" },
  "thread-id": { type: "string" },
  "podman-machine": { type: "string" },
  "coding-admission": { type: "string" },
  "validation-admission": { type: "string" },
  "production-admission": { type: "string" },
  "publication-identity": { type: "string" },
  "feature-criteria": { type: "string" },
  "onboarding-attestation": { type: "string" },
  repo: { type: "string" },
  request: { type: "string" },
  issue: { type: "string" },
  "coding-minutes": { type: "string" },
  "budget-dollars": { type: "string" },
  "repair-cycles": { type: "string" },
  "repair-minutes": { type: "string" },
  dollars: { type: "string" },
  minutes: { type: "string" },
  cycles: { type: "string" },
  clarification: { type: "string" },
  id: { type: "string" },
} as const;
export type CliOptionName = keyof typeof cliOptions;
export type CliValues = {
  [Name in Exclude<CliOptionName, "replace">]?: string | undefined;
} & { replace?: boolean | undefined };
export interface CliCommand {
  kind: "delivery" | "auth";
  required: readonly CliOptionName[];
  optional: readonly CliOptionName[];
  invoke?: (
    controller: DeliveryController,
    values: CliValues,
  ) => unknown | Promise<unknown>;
  authAction?: "prepare" | "store-anthropic-key" | "check-production";
}
type IdAction = {
  [Key in keyof DeliveryController]: DeliveryController[Key] extends (
    id: string,
  ) => unknown
    ? Key
    : never;
}[keyof DeliveryController];
const nativeOptions = ["podman-machine"] as const;
const ownerPolicyOptions = ["owner-policy", "onboarding-attestation"] as const;
const admissionOptions = ["coding-admission", "validation-admission"] as const;
const validationOptions = [
  ...ownerPolicyOptions,
  "podman-machine",
  "validation-admission",
] as const;
// Publication re-checks the validation runtime and the production gate, and
// publishes through the owner's publication record (#267).
const publicationOptions = [
  ...validationOptions,
  "production-admission",
  "publication-identity",
] as const;
// A coding or repair turn: the owner policy and admissions, and the auth
// directory holding the owner's Anthropic key (ADR 0008).
const codingTurnOptions = [
  ...validationOptions,
  "coding-admission",
  "auth-directory",
] as const;
function idAction(
  method: IdAction,
  optional: readonly CliOptionName[] = [],
): CliCommand {
  return {
    kind: "delivery",
    required: ["id"],
    optional,
    invoke: (controller, values) => controller[method](values.id!),
  };
}
const commands: Record<string, CliCommand> = {
  start: {
    kind: "delivery",
    required: ["repo", "request"],
    optional: [
      "issue",
      "coding-minutes",
      "budget-dollars",
      "repair-cycles",
      "repair-minutes",
      "owner-policy",
      "onboarding-attestation",
    ],
    invoke: (c, v) =>
      c.start({
        repository: v.repo!,
        request: v.request!,
        ...(v.issue === undefined ? {} : { issue: v.issue }),
        ...(v["coding-minutes"] === undefined
          ? {}
          : { codingMinutes: Number(v["coding-minutes"]) }),
        ...(v["budget-dollars"] === undefined
          ? {}
          : { budgetDollars: Number(v["budget-dollars"]) }),
        ...(v["repair-cycles"] === undefined
          ? {}
          : { repairCycles: Number(v["repair-cycles"]) }),
        ...(v["repair-minutes"] === undefined
          ? {}
          : { repairMinutes: Number(v["repair-minutes"]) }),
      }),
  },
  status: {
    kind: "delivery",
    required: [],
    optional: ["id"],
    invoke: (c, v) => (v.id === undefined ? c.list() : c.status(v.id)),
  },
  "prepare-auth": {
    kind: "auth",
    authAction: "prepare",
    required: ["repo", "auth-directory"],
    optional: [],
  },
  // ADR 0006: the owner pastes the key at a hidden prompt; one free request
  // verifies it before it reaches the Keychain.
  "store-anthropic-key": {
    kind: "auth",
    authAction: "store-anthropic-key",
    required: ["auth-directory"],
    optional: ["replace"],
  },
  // Ticket 04: checks the owner's production record against the passing
  // qualification report it names, and prints what it admits.
  "check-production": {
    kind: "auth",
    authAction: "check-production",
    required: ["production-admission"],
    optional: [],
  },
  // With owner coding or validation admissions, these also stop or recover
  // the exact native coding session or validation attempt.
  pause: idAction("pause", [...nativeOptions, ...admissionOptions]),
  cancel: idAction("cancel", [...nativeOptions, ...admissionOptions]),
  recover: idAction("recover", [...nativeOptions, ...admissionOptions]),
  resume: idAction("resume"),
  release: idAction("release"),
  "plan-feature": idAction("planFeature", ["feature-criteria"]),
  // These re-read the owner policy, and its attestation, at each step. With
  // owner coding and validation admissions and the owner's key, code-feature
  // runs one metered Claude Code turn on the owner-admitted runtimes.
  "code-feature": {
    kind: "delivery",
    required: ["id"],
    optional: [...codingTurnOptions, "coding-minutes"],
    invoke: (c, v) =>
      c.codeFeature(
        v.id!,
        v["coding-minutes"] === undefined
          ? {}
          : { codingMinutes: Number(v["coding-minutes"]) },
      ),
  },
  // With an owner validation admission, these run on the native runtime.
  "validate-baseline": idAction("validateBaseline", validationOptions),
  "validate-candidate": idAction("validateCandidate", validationOptions),
  // A repair turn runs on the same admitted runtimes and route as a coding
  // turn.
  // Its allowance is the repair's own, so it takes no coding minutes.
  "repair-feature": idAction("repairFeature", codingTurnOptions),
  "publish-feature": idAction("publishFeature", publicationOptions),
  "reconcile-publication": idAction("reconcilePublication", publicationOptions),
  // #268: with the owner policy, these install the native monitor for the
  // policy's GitHub Actions PR checks. A repair also republishes. Each re-checks
  // the publication's validation evidence, so it takes the validation runtime.
  "monitor-pr-checks": idAction("monitorPRChecks", validationOptions),
  "repair-pr-checks": idAction("repairPRChecks", [
    ...codingTurnOptions,
    "production-admission",
    "publication-identity",
  ]),
  // #269: with the owner policy, these install the PR check monitor and the
  // native review adapter. A review repair also republishes.
  "monitor-review": idAction("monitorReview", validationOptions),
  "repair-review": idAction("repairReview", [
    ...codingTurnOptions,
    "production-admission",
    "publication-identity",
  ]),
  // #270: with the owner policy, these install the native fast-forward merge.
  // Merge re-checks the PR checks, the review and the production admission
  // right before it pushes, so it takes their runtimes; a refresh repairs
  // and republishes.
  "merge-feature": idAction("mergeFeature", [
    ...validationOptions,
    "production-admission",
  ]),
  "reconcile-merge": idAction("reconcileMerge", ownerPolicyOptions),
  "refresh-merge-base": idAction("refreshMergeBase", [
    ...codingTurnOptions,
    "production-admission",
    "publication-identity",
  ]),
  // #271: with the owner policy, this installs the native read-only main
  // observer for the policy's GitHub Actions main checks.
  "monitor-main-checks": idAction("monitorMainChecks", ownerPolicyOptions),
  // #272: with the owner policy, these install the native fast-forward-only
  // main sync and, since sync re-checks main first, the main observer.
  "sync-main": idAction("syncMain", ownerPolicyOptions),
  "reconcile-main-sync": idAction("reconcileMainSync", ownerPolicyOptions),
  "cleanup-branches": idAction("cleanupBranches"),
  "reconcile-cleanup": idAction("reconcileCleanup"),
  "rerun-pr-check": {
    kind: "delivery",
    required: ["id", "check-id"],
    optional: validationOptions,
    invoke: (c, v) => c.rerunPRCheck(v.id!, v["check-id"]!),
  },
  "resolve-review-thread": {
    kind: "delivery",
    required: ["id", "thread-id"],
    optional: validationOptions,
    invoke: (c, v) => c.resolveReviewThread(v.id!, v["thread-id"]!),
  },
  "clarify-feature": {
    kind: "delivery",
    required: ["id", "clarification"],
    optional: ["feature-criteria"],
    invoke: (c, v) => c.clarifyFeature(v.id!, v.clarification!),
  },
  "extend-coding": {
    kind: "delivery",
    required: ["id", "minutes"],
    optional: [],
    invoke: (c, v) => c.extendCoding(v.id!, Number(v.minutes)),
  },
  // ADR 0008: the owner's budget extension after a budget interruption.
  "extend-budget": {
    kind: "delivery",
    required: ["id", "dollars"],
    optional: [],
    invoke: (c, v) => c.extendBudget(v.id!, Number(v.dollars)),
  },
  "extend-repair": {
    kind: "delivery",
    required: ["id"],
    optional: ["minutes", "cycles"],
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
      }),
    ]),
  ),
);
export function validateCliCommand(
  positionals: readonly string[],
  values: CliValues,
  names: readonly string[],
): { command: CliCommand; name: string } | { error: "arguments" } {
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
  // A coding turn is metered through the owner's Anthropic key (ADR 0008)
  // on the owner-admitted coding runtime; its authority is the delivery's
  // spend budget.
  if (
    command.kind === "delivery" &&
    values["auth-directory"] !== undefined &&
    !values["coding-admission"]
  )
    return { error: "arguments" };
  if (
    values["podman-machine"] !== undefined &&
    !/^aios-[a-z0-9-]+$/.test(values["podman-machine"])
  )
    return { error: "arguments" };
  if (
    values["feature-criteria"] === "" ||
    values["publication-identity"] === "" ||
    (command.kind === "delivery" && values["production-admission"] === "")
  )
    return { error: "arguments" };
  if (
    values["onboarding-attestation"] !== undefined &&
    (!values["onboarding-attestation"] || !values["owner-policy"])
  )
    return { error: "arguments" };
  if (
    values["coding-admission"] !== undefined &&
    (!values["coding-admission"] || !values["podman-machine"])
  )
    return { error: "arguments" };
  if (
    values["validation-admission"] !== undefined &&
    (!values["validation-admission"] || !values["podman-machine"])
  )
    return { error: "arguments" };
  for (const option of ["budget-dollars", "dollars"] as const)
    if (
      values[option] !== undefined &&
      !/^[0-9]{1,4}(\.[0-9]{1,2})?$/.test(values[option]!)
    )
      return { error: "arguments" };
  for (const [option, max] of [
    ["coding-minutes", 1440],
    ["repair-minutes", 1440],
    ["repair-cycles", 100],
  ] as const)
    if (
      values[option] !== undefined &&
      (!/^[1-9][0-9]{0,3}$/.test(values[option]!) ||
        Number(values[option]) > max)
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
