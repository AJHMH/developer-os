import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  Delivery,
  WorkerAdapter,
  WorkerSession,
  WorkerReceipt,
} from "./controller.js";
import {
  isolationProbes,
  unavailableQualification,
  type IsolationProbe,
  type WorkerQualification,
} from "./qualification.js";
import { redact } from "./redaction.js";
import { admitFiles, materializeWorkspace } from "./workspace.js";

export interface RuntimeBinding {
  platform: "win32" | "darwin";
  arch: "x64" | "arm64";
  osVersion: string;
  hypervisor: boolean;
  sbxVersion: string;
  codexVersion: string;
  template: string;
  hostId: string;
}
export interface WorkerPolicy {
  schema: 1;
  authorityDirectory: string;
  workspaceDirectory: string;
  binding: RuntimeBinding;
  revision: string;
  files: { path: string; sha256: string }[];
  proxy: { binding: string; endpoints: string[]; spendingLimitUsd: number };
  dependencies: string[];
}
export interface ProbeChallenge {
  name: IsolationProbe;
  challengeId: string;
  policySha256: string;
  bindingSha256: string;
  canary: string;
}
export interface ProbeObservation extends ProbeChallenge {
  outcome: "passed" | "failed" | "not-run";
  observed: boolean;
  evidenceSha256: string;
}
/** Trusted runtime operations, never supplied by a policy file or candidate.
 * Real implementations must target sbx microVMs, inspect effective configuration,
 * and implement atomic repository-scoped fencing. Controlled ports cannot make
 * liveReady true. No process/container fallback exists in this adapter. */
export interface SandboxRuntime {
  readonly mode: "live" | "controlled" | "unavailable";
  inspect(): RuntimeBinding | undefined;
  probe(challenge: ProbeChallenge): Promise<ProbeObservation>;
  create(request: SandboxRequest): Promise<EffectiveSandbox>;
  inspectSandbox(session: WorkerSession): Promise<EffectiveSandbox>;
  launch(request: {
    session: WorkerSession;
    codexVersion: string;
    policySha256: string;
    mayDispatch: () => boolean;
  }): Promise<WorkerReceipt>;
  revokeAndStop(
    session: WorkerSession,
  ): Promise<WorkerSession & { revoked: boolean; descendantsStopped: boolean }>;
}
export interface SandboxRequest {
  session: WorkerSession;
  kind: "docker-sandboxes-microvm";
  template: string;
  workspace: string;
  policySha256: string;
  manifestSha256: string;
  skills: "off";
  hostMounts: never[];
  environment: Record<string, never>;
  proxy: WorkerPolicy["proxy"];
  dependencies: string[];
}
export interface EffectiveSandbox extends SandboxRequest {
  sharedSkills: boolean;
  hostMcp: boolean;
  sshForwarding: boolean;
  hostHooks: boolean;
  githubBindings: string[];
  rawModelCredential: boolean;
  networkPolicySha256: string;
  modelBinding: string;
  spendingLimitUsd: number;
  copiedManifestSha256: string;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function outside(root: string, path: string): boolean {
  const difference = relative(root, path);
  return (
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  );
}
function validBinding(binding: RuntimeBinding): boolean {
  return (
    binding &&
    ((binding.platform === "win32" &&
      binding.arch === "x64" &&
      /^10\.0\.[0-9]+$/.test(binding.osVersion) &&
      Number(binding.osVersion.split(".")[2]) >= 22000) ||
      (binding.platform === "darwin" &&
        binding.arch === "arm64" &&
        /^\d+\.\d+(?:\.\d+)?$/.test(binding.osVersion) &&
        Number(binding.osVersion.split(".")[0]) >= 14)) &&
    binding.hypervisor === true &&
    /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(binding.sbxVersion) &&
    /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(binding.codexVersion) &&
    /^[A-Za-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(binding.template) &&
    sha(binding.hostId)
  );
}
function bindingHash(binding: RuntimeBinding): string {
  if (!validBinding(binding)) throw Error("Unverified runtime binding");
  return digest(
    JSON.stringify({
      platform: binding.platform,
      arch: binding.arch,
      osVersion: binding.osVersion,
      hypervisor: binding.hypervisor,
      sbxVersion: binding.sbxVersion,
      codexVersion: binding.codexVersion,
      template: binding.template,
      hostId: binding.hostId,
    }),
  );
}
function endpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port &&
      /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(url.hostname) &&
      !/(?:^|\.)(?:github\.com|githubusercontent\.com|github\.io|docker\.internal|local|localhost)$/.test(
        url.hostname,
      ) &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
function loadPolicy(
  path: string,
  repository: string,
  authority: string,
): { policy: WorkerPolicy; sha256: string } {
  if (!isAbsolute(path) || !outside(repository, resolve(path)))
    throw Error("Invalid external worker policy");
  let ancestor = dirname(resolve(path));
  while (true) {
    if (!outside(repository, realpathSync(ancestor)))
      throw Error("Candidate policy path");
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const source = realpathSync(path),
    entry = lstatSync(path);
  if (
    !outside(repository, source) ||
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.nlink !== 1 ||
    entry.size > 65536 ||
    redact(source) !== source
  )
    throw Error("Invalid external worker policy");
  const document = readFileSync(source, "utf8");
  const policy = JSON.parse(document) as WorkerPolicy;
  const only = (value: object, keys: string[]) =>
    Object.keys(value).every((key) => keys.includes(key));
  if (
    !only(policy, [
      "schema",
      "authorityDirectory",
      "workspaceDirectory",
      "binding",
      "revision",
      "files",
      "proxy",
      "dependencies",
    ]) ||
    !only(policy.binding, [
      "platform",
      "arch",
      "osVersion",
      "hypervisor",
      "sbxVersion",
      "codexVersion",
      "template",
      "hostId",
    ]) ||
    !only(policy.proxy, ["binding", "endpoints", "spendingLimitUsd"])
  )
    throw Error("Unexpected worker authority fields");
  if (
    policy.schema !== 1 ||
    !validBinding(policy.binding) ||
    !/^[a-f0-9]{40}$/.test(policy.revision) ||
    !isAbsolute(policy.authorityDirectory) ||
    realpathSync(policy.authorityDirectory) !== authority ||
    !isAbsolute(policy.workspaceDirectory)
  )
    throw Error("Invalid worker pins");
  const workspace = realpathSync(policy.workspaceDirectory);
  if (
    !outside(repository, workspace) ||
    !outside(workspace, repository) ||
    !outside(authority, workspace) ||
    !outside(workspace, authority) ||
    lstatSync(policy.workspaceDirectory).isSymbolicLink() ||
    !lstatSync(workspace).isDirectory()
  )
    throw Error("Unsafe workspace root");
  if (
    !Array.isArray(policy.files) ||
    !policy.files.length ||
    policy.files.length > 10000 ||
    policy.files.some(
      (file) =>
        !only(file, ["path", "sha256"]) ||
        typeof file.path !== "string" ||
        !sha(file.sha256),
    )
  )
    throw Error("Invalid admitted manifest");
  if (
    !policy.proxy ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(policy.proxy.binding) ||
    !Number.isFinite(policy.proxy.spendingLimitUsd) ||
    policy.proxy.spendingLimitUsd <= 0 ||
    !Array.isArray(policy.proxy.endpoints) ||
    !policy.proxy.endpoints.length ||
    !policy.proxy.endpoints.every(endpoint) ||
    !Array.isArray(policy.dependencies) ||
    !policy.dependencies.every(endpoint)
  )
    throw Error("Invalid model-only policy");
  return { policy, sha256: digest(document) };
}

export class SandboxWorkerAdapter implements WorkerAdapter {
  private readonly admitted = new Map<
    string,
    {
      delivery: Delivery;
      authority: string;
      policy: WorkerPolicy;
      sha256: string;
    }
  >();
  constructor(
    private readonly policyPath: string | undefined,
    private readonly runtime: SandboxRuntime,
  ) {}
  async probe(
    delivery: Delivery,
    authorityDirectory: string,
  ): Promise<WorkerQualification> {
    const report = unavailableQualification();
    report.mode = this.runtime.mode;
    try {
      if (!this.policyPath) throw Error("Missing policy");
      const pinned = loadPolicy(
        this.policyPath,
        delivery.repository,
        authorityDirectory,
      );
      admitFiles(pinned.policy, delivery.repository);
      const binding = this.runtime.inspect();
      if (
        !binding ||
        bindingHash(binding) !== bindingHash(pinned.policy.binding)
      )
        throw Error("Missing or changed runtime");
      report.policySha256 = pinned.sha256;
      report.bindingSha256 = bindingHash(binding);
      report.blockers = [];
      for (const name of isolationProbes) {
        const challenge: ProbeChallenge = {
          name,
          challengeId: randomUUID(),
          canary: `synthetic-${randomUUID()}`,
          policySha256: pinned.sha256,
          bindingSha256: report.bindingSha256,
        };
        let outcome: "passed" | "failed" | "not-run" = "not-run";
        let evidenceSha256: string | undefined;
        try {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const observed = await Promise.race([
            this.runtime.probe(challenge),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(Error("Probe timed out")), 2000);
            }),
          ]).finally(() => {
            if (timer) clearTimeout(timer);
          });
          if (
            observed.challengeId === challenge.challengeId &&
            observed.name === name &&
            observed.policySha256 === pinned.sha256 &&
            observed.bindingSha256 === report.bindingSha256 &&
            observed.observed === true &&
            sha(observed.evidenceSha256)
          ) {
            outcome = observed.outcome === "passed" ? "passed" : "failed";
            evidenceSha256 = observed.evidenceSha256;
          }
        } catch {
          /* No raw error or canary contents enter durable evidence. */
        }
        report.probes = report.probes.map((probe) =>
          probe.name === name
            ? { name, outcome, ...(evidenceSha256 ? { evidenceSha256 } : {}) }
            : probe,
        );
        if (outcome !== "passed")
          report.blockers.push(
            `Demonstrate ${name} enforcement with fresh version-bound canary evidence.`,
          );
      }
      report.ready =
        this.runtime.mode !== "unavailable" && report.blockers.length === 0;
      report.liveReady = report.ready && this.runtime.mode === "live";
    } catch {
      report.blockers = [
        "Verify external worker policy, supported host/hypervisor, exact sbx/Codex/template pins and the configured authority/workspace roots before probing.",
      ];
    }
    return report;
  }
  qualified(delivery: Delivery, authorityDirectory: string): boolean {
    try {
      if (!this.policyPath) return false;
      const report = delivery.qualification;
      const pinned = loadPolicy(
        this.policyPath,
        delivery.repository,
        authorityDirectory,
      );
      const binding = this.runtime.inspect();
      const ready = Boolean(
        report?.ready &&
          report.mode === this.runtime.mode &&
          this.runtime.mode !== "unavailable" &&
          report.policySha256 === pinned.sha256 &&
          binding &&
          report.bindingSha256 === bindingHash(binding) &&
          bindingHash(binding) === bindingHash(pinned.policy.binding) &&
          isolationProbes.every((name) =>
            report.probes.some(
              (probe) =>
                probe.name === name &&
                probe.outcome === "passed" &&
                sha(probe.evidenceSha256),
            ),
          ),
      );
      if (ready)
        this.admitted.set(delivery.id, {
          delivery: structuredClone(delivery),
          authority: authorityDirectory,
          policy: pinned.policy,
          sha256: pinned.sha256,
        });
      else this.admitted.delete(delivery.id);
      return ready;
    } catch {
      this.admitted.delete(delivery.id);
      return false;
    }
  }
  async start(
    session: WorkerSession,
    mayDispatch?: () => boolean,
  ): Promise<WorkerReceipt> {
    const context = this.admitted.get(session.deliveryId);
    if (
      !context ||
      !mayDispatch ||
      !mayDispatch() ||
      !this.qualified(context.delivery, context.authority) ||
      session.repositoryKey !== context.delivery.ownership.key
    )
      throw Error("Sandbox launch is not qualified");
    let effective: EffectiveSandbox;
    let expectedWorkspace: string | undefined;
    if (session.intent === "resume") {
      const previous = context.delivery.execution;
      if (
        previous?.state !== "stopped" ||
        previous.sandboxId !== session.sandboxId ||
        previous.workerSessionId !== session.workerSessionId
      )
        throw Error("Explicit retained session is required");
      effective = await this.runtime.inspectSandbox(session);
    } else {
      const workspace = materializeWorkspace(
        context.policy,
        context.delivery.repository,
      );
      expectedWorkspace = workspace.path;
      effective = await this.runtime.create({
        session: structuredClone(session),
        kind: "docker-sandboxes-microvm",
        template: context.policy.binding.template,
        workspace: workspace.path,
        policySha256: context.sha256,
        manifestSha256: workspace.manifestSha256,
        skills: "off",
        hostMounts: [],
        environment: {},
        proxy: structuredClone(context.policy.proxy),
        dependencies: [...context.policy.dependencies],
      });
    }
    const manifest = digest(JSON.stringify(context.policy.files));
    if (
      effective.kind !== "docker-sandboxes-microvm" ||
      effective.policySha256 !== context.sha256 ||
      (expectedWorkspace !== undefined &&
        effective.workspace !== expectedWorkspace) ||
      effective.manifestSha256 !== manifest ||
      effective.session.sandboxId !== session.sandboxId ||
      effective.session.workerSessionId !== session.workerSessionId ||
      effective.session.deliveryId !== session.deliveryId ||
      effective.session.repositoryKey !== session.repositoryKey ||
      effective.session.operationId !== session.operationId ||
      effective.session.runnerId !== session.runnerId ||
      effective.session.fence !== session.fence ||
      effective.template !== context.policy.binding.template ||
      effective.skills !== "off" ||
      Object.keys(effective.environment).length !== 0 ||
      JSON.stringify(effective.proxy) !==
        JSON.stringify(context.policy.proxy) ||
      JSON.stringify(effective.dependencies) !==
        JSON.stringify(context.policy.dependencies) ||
      effective.hostMounts.length !== 0 ||
      effective.sharedSkills !== false ||
      effective.hostMcp !== false ||
      effective.sshForwarding !== false ||
      effective.hostHooks !== false ||
      effective.githubBindings.length !== 0 ||
      effective.rawModelCredential !== false ||
      effective.networkPolicySha256 !== context.sha256 ||
      effective.modelBinding !== context.policy.proxy.binding ||
      effective.spendingLimitUsd !== context.policy.proxy.spendingLimitUsd ||
      effective.copiedManifestSha256 !== manifest ||
      !mayDispatch() ||
      !this.qualified(context.delivery, context.authority)
    )
      throw Error("Effective sandbox isolation is not verified");
    return this.runtime.launch({
      session: structuredClone(session),
      codexVersion: context.policy.binding.codexVersion,
      policySha256: context.sha256,
      mayDispatch,
    });
  }
  async fenceAndStop(session: WorkerSession): Promise<WorkerReceipt> {
    try {
      const stopped = await this.runtime.revokeAndStop(
        structuredClone(session),
      );
      const matches = [
        "deliveryId",
        "repositoryKey",
        "operationId",
        "sandboxId",
        "workerSessionId",
        "runnerId",
        "fence",
      ].every(
        (key) =>
          stopped[key as keyof WorkerSession] ===
          session[key as keyof WorkerSession],
      );
      return {
        ...session,
        status:
          matches &&
          stopped.revoked === true &&
          stopped.descendantsStopped === true
            ? "stopped"
            : "unknown",
      };
    } catch {
      return { ...session, status: "unknown" };
    }
  }
}
