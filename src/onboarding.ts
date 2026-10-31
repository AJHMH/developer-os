import { spawnSync } from "node:child_process";
import { hostGitCwd } from "./host-git.js";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathContains } from "./path-containment.js";
import { redact } from "./redaction.js";
import { readOwnerRecord } from "./coding-admission.js";

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
  /** The owner's private onboarding attestation (ADR 0004): facts the host
   * cannot observe, attested for exactly the pinned policy. */
  attestationPath?: string;
}
const attestationScope = "aios-onboarding-attestation-v1";
/** What an attestation may supply: never the local repository hints, which
 * are always observed. */
const attestable = [
  "repository",
  "defaultBranch",
  "factoryCommit",
  "appLogin",
  "appRepositoryAccess",
  "eligibleApprovers",
  "protectionsEnforced",
  "requiredChecks",
  "trustedCheckPublishers",
  "publicationLogin",
  "publicationAccess",
  "localSignature",
  "githubSignature",
  "validation",
] as const satisfies readonly (keyof OnboardingObservation)[];
/** The owner's attested facts for exactly `policySha256`; throws otherwise. */
function attestedFacts(
  path: string,
  policySha256: string,
): { facts: OnboardingObservation; sha256: string; attestedAt: string } {
  const record = readOwnerRecord(path, 65536) as Record<string, unknown>;
  const facts = record?.facts as Record<string, unknown> | undefined;
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).sort().join() !==
      "attestedAt,facts,policySha256,scope" ||
    record.scope !== attestationScope ||
    record.policySha256 !== policySha256 ||
    typeof record.attestedAt !== "string" ||
    new Date(record.attestedAt).toISOString() !== record.attestedAt ||
    Date.parse(record.attestedAt) > Date.now() ||
    !facts ||
    typeof facts !== "object" ||
    Array.isArray(facts) ||
    Object.keys(facts).some(
      (key) => !(attestable as readonly string[]).includes(key),
    )
  )
    throw Error("Invalid onboarding attestation");
  return {
    facts: facts as OnboardingObservation,
    sha256: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
    attestedAt: record.attestedAt,
  };
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
  /** The owner attestation the `attested` facts came from. */
  attestation?: {
    source: "owner-attested";
    sha256: string;
    attestedAt: string;
  };
  facts: {
    requirement: Requirement;
    /** `attested` matches the policy on the owner's word, not live
     * verification; it admits controlled delivery only (ADR 0004). */
    status: "verified" | "attested" | "unknown" | "conflict";
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
    status: "verified" | "attested" | "unknown" | "conflict",
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
    // Attested facts fill only what inspection left unobserved.
    const attested = new Set<string>();
    if (options.attestationPath) {
      let attestation: ReturnType<typeof attestedFacts> | undefined;
      try {
        attestation = attestedFacts(options.attestationPath, pinned.sha256);
      } catch {
        record(
          "policy",
          "conflict",
          "The owner onboarding attestation must be a valid private external record for exactly this policy.",
        );
      }
      if (attestation) {
        report.attestation = {
          source: "owner-attested",
          sha256: attestation.sha256,
          attestedAt: attestation.attestedAt,
        };
        for (const [key, value] of Object.entries(attestation.facts))
          if (observation[key as keyof OnboardingObservation] === undefined) {
            attested.add(key);
            observation = { ...observation, [key]: value };
          }
      }
    }
    const evaluate = (
      requirement: Requirement,
      keys: (keyof OnboardingObservation)[],
      matches: () => boolean,
    ) => {
      if (keys.some((key) => observation[key] === undefined)) return;
      try {
        const verified = matches(),
          byOwner = keys.some((key) => attested.has(key));
        record(
          requirement,
          !verified ? "conflict" : byOwner ? "attested" : "verified",
          !verified
            ? "Observed evidence conflicts with the pinned owner policy."
            : byOwner
              ? "The owner's attestation, not live verification, matches the pinned owner policy."
              : "Trusted inspection matches the pinned owner policy.",
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
      ["localRepository", "localDefaultBranch", "repository", "defaultBranch"],
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
      ["factoryCommit"],
      () => o.factoryCommit === p.factoryCommit,
    );
    if (
      ["verified", "attested"].includes(
        report.facts.find((fact) => fact.requirement === "repositoryIdentity")
          ?.status ?? "",
      )
    )
      report.canonicalRepository = {
        name: p.repository,
        defaultBranch: p.defaultBranch,
      };
    evaluate(
      "app",
      ["appLogin", "appRepositoryAccess"],
      () => o.appLogin === p.appLogin && o.appRepositoryAccess === true,
    );
    evaluate(
      "approver",
      ["eligibleApprovers"],
      () =>
        o.eligibleApprovers?.length === 1 &&
        o.eligibleApprovers[0] === p.approver,
    );
    evaluate(
      "protections",
      ["protectionsEnforced", "requiredChecks", "trustedCheckPublishers"],
      () =>
        o.protectionsEnforced === true &&
        o.trustedCheckPublishers === true &&
        p.requiredChecks.every((check) => o.requiredChecks?.includes(check)) &&
        o.requiredChecks?.every((check) => p.requiredChecks.includes(check)) ===
          true,
    );
    evaluate(
      "publication",
      ["publicationLogin", "publicationAccess"],
      () =>
        o.publicationLogin === p.publicationLogin &&
        o.publicationAccess === true,
    );
    evaluate(
      "signing",
      ["localSignature", "githubSignature"],
      () =>
        o.localSignature?.valid === true &&
        o.githubSignature?.valid === true &&
        /^[a-f0-9]{40}$/.test(o.localSignature.commit) &&
        o.localSignature.commit === o.githubSignature.commit &&
        o.localSignature.login === p.publicationLogin &&
        o.githubSignature.login === p.publicationLogin,
    );
    evaluate("validation", ["validation"], () =>
      p.validation.every((resource) => o.validation?.includes(resource)),
    );
  }
  report.checklist = report.facts
    .filter((fact) => !["verified", "attested"].includes(fact.status))
    .map((fact) => ({
      requirement: fact.requirement,
      action: prerequisites[fact.requirement],
    }));
  report.ready = report.checklist.length === 0;
  return report;
}
