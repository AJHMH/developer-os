import { spawnSync } from "node:child_process";
import { hostGitCwd } from "./host-git.js";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathContains } from "./path-containment.js";
import { redact } from "./redaction.js";

export const prerequisites = {
  repositoryIdentity:
    "Verify the selected remote, canonical GitHub repository and local/live default branch agree.",
  factory:
    "Pin and verify the trusted Factory release or commit outside the candidate repository.",
  policy: "Pin owner policy provenance outside the candidate repository.",
  app: "Verify installation repository access and Factory App PR authorship identity.",
  approver: "Verify the owner is the sole eligible human approver.",
  protections:
    "Verify effective protections and required checks with trusted publishers.",
  signing:
    "Demonstrate local signature validity and GitHub verification for the same published commit and identity.",
  publication:
    "Verify the owner publication identity and repository permissions.",
  validation:
    "Verify declared validation infrastructure and disposable resources are available.",
} as const;
export type Requirement = keyof typeof prerequisites;
interface OwnerPolicy {
  repository: string;
  defaultBranch: string;
  factoryCommit: string;
  approver: string;
  appLogin: string;
  publicationLogin: string;
  requiredChecks: string[];
  validation: string[];
}
interface Signature {
  commit: string;
  valid: boolean;
  login: string;
}
/** Supplied only by trusted host integration, never by feature requests or worker output. */
export interface OnboardingObservation {
  localRepository?: string;
  localDefaultBranch?: string;
  repository?: string;
  defaultBranch?: string;
  factoryCommit?: string;
  appLogin?: string;
  appRepositoryAccess?: boolean;
  eligibleApprovers?: string[];
  protectionsEnforced?: boolean;
  requiredChecks?: string[];
  trustedCheckPublishers?: boolean;
  publicationLogin?: string;
  publicationAccess?: boolean;
  localSignature?: Signature;
  githubSignature?: Signature;
  validation?: string[];
}
export interface OnboardingOptions {
  policyPath?: string;
  inspect?: (repository: string) => OnboardingObservation;
}
/** Local hints only: never fetch, execute hooks, contact a remote or claim live verification. */
export function inspectLocalRepository(
  repository: string,
): OnboardingObservation {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  env.GIT_OPTIONAL_LOCKS = "0";
  const read = (args: string[]) => {
    const result = spawnSync("git", ["-C", repository, ...args], {
      env,
      cwd: hostGitCwd,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65536,
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  };
  const remote = read([
    "config",
    "--local",
    "--no-includes",
    "--get",
    "remote.origin.url",
  ]);
  const match = remote?.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  const head = read(["symbolic-ref", "refs/remotes/origin/HEAD"]);
  return {
    ...(remote === undefined
      ? {}
      : { localRepository: match?.[1] ?? "invalid-selected-remote" }),
    ...(head?.startsWith("refs/remotes/origin/")
      ? { localDefaultBranch: head.slice("refs/remotes/origin/".length) }
      : {}),
  };
}
export interface OnboardingReport {
  ready: boolean;
  checkedAt: string;
  policy?: { source: string; sha256: string; factoryCommit: string };
  canonicalRepository?: { name: string; defaultBranch: string };
  facts: {
    requirement: Requirement;
    status: "verified" | "unknown" | "conflict";
    detail: string;
  }[];
  checklist: { requirement: Requirement; action: string }[];
}
function outside(repository: string, path: string): boolean {
  return !pathContains(repository, path);
}
function loadPolicy(
  repository: string,
  path: string,
): { policy: OwnerPolicy; source: string; sha256: string } {
  const root = realpathSync(repository);
  if (!isAbsolute(path) || !outside(root, resolve(path)))
    throw new Error("Invalid policy");
  // Check every traversed ancestor: a candidate alias may lead back outside
  // after passing through a directory the worker controls.
  let ancestor = dirname(resolve(path));
  while (true) {
    if (!outside(root, realpathSync(ancestor)))
      throw new Error("Invalid policy");
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const source = realpathSync(path);
  if (redact(source) !== source) throw new Error("Invalid policy");
  const entry = lstatSync(path);
  if (
    !outside(root, source) ||
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.nlink !== 1 ||
    entry.size > 65536
  )
    throw new Error("Invalid policy");
  const document = readFileSync(source, "utf8");
  const policy = JSON.parse(document) as OwnerPolicy;
  for (const key of [
    "repository",
    "defaultBranch",
    "factoryCommit",
    "approver",
    "appLogin",
    "publicationLogin",
  ] as const) {
    if (
      typeof policy[key] !== "string" ||
      !/^[A-Za-z0-9_./\[\]-]{1,200}$/.test(policy[key])
    )
      throw new Error("Invalid policy");
  }
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy.repository) ||
    !/^[a-f0-9]{40}$/.test(policy.factoryCommit)
  )
    throw new Error("Invalid policy");
  for (const key of ["requiredChecks", "validation"] as const) {
    if (
      !Array.isArray(policy[key]) ||
      !policy[key].length ||
      policy[key].some(
        (value) =>
          typeof value !== "string" ||
          !value.trim() ||
          value.length > 200 ||
          /[\u0000-\u001f]/.test(value),
      )
    )
      throw new Error("Invalid policy");
  }
  return {
    policy,
    source,
    sha256: createHash("sha256").update(document).digest("hex"),
  };
}
export function inspectOnboarding(
  repository: string,
  options: OnboardingOptions,
): OnboardingReport {
  const requirements = Object.keys(prerequisites) as Requirement[];
  const report: OnboardingReport = {
    ready: false,
    checkedAt: new Date().toISOString(),
    facts: requirements.map((requirement) => ({
      requirement,
      status: "unknown",
      detail: "No trusted verification evidence is available.",
    })),
    checklist: [],
  };
  const record = (
    requirement: Requirement,
    status: "verified" | "unknown" | "conflict",
    detail: string,
  ) => {
    const fact = report.facts.find((fact) => fact.requirement === requirement)!;
    fact.status = status;
    fact.detail = detail;
  };
  let pinned: ReturnType<typeof loadPolicy> | undefined;
  if (options.policyPath) {
    try {
      pinned = loadPolicy(repository, options.policyPath);
      report.policy = {
        source: pinned.source,
        sha256: pinned.sha256,
        factoryCommit: pinned.policy.factoryCommit,
      };
      record(
        "policy",
        "verified",
        "Owner policy snapshot is outside the candidate and content-addressed.",
      );
    } catch {
      record(
        "policy",
        "conflict",
        "Owner policy must be a valid ordinary external file with explicit pins.",
      );
    }
  }
  if (pinned) {
    const p = pinned.policy;
    let observation: OnboardingObservation = {};
    try {
      observation = options.inspect?.(repository) ?? {};
    } catch {
      /* Unknown evidence blocks delivery; never retain provider errors. */
    }
    const evaluate = (
      requirement: Requirement,
      values: unknown[],
      matches: () => boolean,
    ) => {
      if (values.some((value) => value === undefined)) return;
      try {
        const verified = matches();
        record(
          requirement,
          verified ? "verified" : "conflict",
          verified
            ? "Trusted inspection matches the pinned owner policy."
            : "Observed evidence conflicts with the pinned owner policy.",
        );
      } catch {
        record(
          requirement,
          "conflict",
          "Inspection returned invalid evidence.",
        );
      }
    };
    const o = observation;
    evaluate(
      "repositoryIdentity",
      [o.localRepository, o.localDefaultBranch, o.repository, o.defaultBranch],
      () =>
        o.localRepository === p.repository &&
        o.repository === p.repository &&
        o.localDefaultBranch === p.defaultBranch &&
        o.defaultBranch === p.defaultBranch,
    );
    if (
      [o.localRepository, o.repository].some(
        (value) => value !== undefined && value !== p.repository,
      ) ||
      [o.localDefaultBranch, o.defaultBranch].some(
        (value) => value !== undefined && value !== p.defaultBranch,
      )
    )
      record(
        "repositoryIdentity",
        "conflict",
        "Selected local/remote identity conflicts with the owner pin; do not rewrite it implicitly.",
      );
    evaluate(
      "factory",
      [o.factoryCommit],
      () => o.factoryCommit === p.factoryCommit,
    );
    if (
      report.facts.find((fact) => fact.requirement === "repositoryIdentity")
        ?.status === "verified"
    )
      report.canonicalRepository = {
        name: p.repository,
        defaultBranch: p.defaultBranch,
      };
    evaluate(
      "app",
      [o.appLogin, o.appRepositoryAccess],
      () => o.appLogin === p.appLogin && o.appRepositoryAccess === true,
    );
    evaluate(
      "approver",
      [o.eligibleApprovers],
      () =>
        o.eligibleApprovers?.length === 1 &&
        o.eligibleApprovers[0] === p.approver,
    );
    evaluate(
      "protections",
      [o.protectionsEnforced, o.requiredChecks, o.trustedCheckPublishers],
      () =>
        o.protectionsEnforced === true &&
        o.trustedCheckPublishers === true &&
        p.requiredChecks.every((check) => o.requiredChecks?.includes(check)) &&
        o.requiredChecks?.every((check) => p.requiredChecks.includes(check)) ===
          true,
    );
    evaluate(
      "publication",
      [o.publicationLogin, o.publicationAccess],
      () =>
        o.publicationLogin === p.publicationLogin &&
        o.publicationAccess === true,
    );
    evaluate(
      "signing",
      [o.localSignature, o.githubSignature],
      () =>
        o.localSignature?.valid === true &&
        o.githubSignature?.valid === true &&
        /^[a-f0-9]{40}$/.test(o.localSignature.commit) &&
        o.localSignature.commit === o.githubSignature.commit &&
        o.localSignature.login === p.publicationLogin &&
        o.githubSignature.login === p.publicationLogin,
    );
    evaluate("validation", [o.validation], () =>
      p.validation.every((resource) => o.validation?.includes(resource)),
    );
  }
  report.checklist = report.facts
    .filter((fact) => fact.status !== "verified")
    .map((fact) => ({
      requirement: fact.requirement,
      action: prerequisites[fact.requirement],
    }));
  report.ready = report.checklist.length === 0;
  return report;
}
