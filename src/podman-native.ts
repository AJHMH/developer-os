import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { WorkerSession } from "./controller.js";
import {
  syntheticGatewayAccount,
  syntheticGatewayApproval,
} from "./gateway-canary.js";
import { hostCanaryVersion, withHostCanary } from "./host-canary.js";
import { codexWorkerSha256, hostTargets } from "./host-target.js";
import { nativeProbeDiagnostic } from "./native-diagnostics.js";
import {
  canaryInput,
  canaryOutput,
  matchesCanary,
  sha256,
  type CanaryCollection,
  type CanaryExecution,
  type CanaryPins,
  type CanaryStop,
  type OfflineCanaryRuntime,
} from "./offline-canary.js";
import { pathContains } from "./path-containment.js";
import type { PodmanObservation } from "./podman-host.js";
import {
  gatewayRequest,
  HostSubscriptionGateway,
  subscriptionGatewayVersion,
  syntheticGatewayResponse,
} from "./subscription-gateway.js";
import {
  VMManagementChannel,
  vmManagementVersion,
  type VMAction,
} from "./vm-management.js";
export { codexWorkerSha256 } from "./host-target.js";

export const offlineTemplate = hostTargets.win32.offlineTemplate;

/** Runs only in the VM's trusted management namespace, not in the worker.
 * A machine-wide flock serializes dispatch with durable revocation. A single
 * authority directory is bound during explicit enrollment. Worker containers
 * cannot mount/read this directory, its lock, engine sockets or the host.
 * Artifact transport is the bounded fixed stdout record, read twice only after
 * independent cgroup/PID shutdown. No tar extraction or guest paths are imported. */

function ordinary(path: string, directory = false): void {
  const entry = lstatSync(path);
  if (
    entry.isSymbolicLink() ||
    (platform() === "win32"
      ? realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
      : realpathSync(path) !== resolve(path)) ||
    (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)
  )
    throw Error("Unsafe native path");
}
function contains(root: string, path: string): boolean {
  return pathContains(root, path);
}
export class NativePodmanDriver implements OfflineCanaryRuntime {
  readonly mode = "live" as const;
  constructor(
    readonly machine: string,
    readonly authorityDirectory: string,
    readonly policyPath: string,
  ) {
    if (
      !/^aios-[a-z0-9-]+$/.test(machine) ||
      !isAbsolute(authorityDirectory) ||
      !isAbsolute(policyPath)
    )
      throw Error("Invalid native driver options");
  }
  private get management() {
    return new VMManagementChannel(this.machine, this.authorityDirectory);
  }
  private invoke(action: VMAction, payload: Record<string, unknown> = {}): any {
    return this.management.invoke(action, payload);
  }
  boundaryProbe(payload: Record<string, unknown>) {
    return this.invoke("boundary-probe", payload);
  }
  taskExecute(payload: Record<string, unknown>) {
    return this.invoke("task-execute", payload);
  }
  taskCollect(payload: Record<string, unknown>) {
    return this.invoke("task-collect", payload);
  }
  private async gatewayInvocation(
    payload: Record<string, unknown>,
    deliveryId: string,
    approvedGateway?: HostSubscriptionGateway | (() => HostSubscriptionGateway),
  ): Promise<any> {
    const transportCapability = randomBytes(32).toString("hex");
    let gateway =
      typeof approvedGateway === "function" ? undefined : approvedGateway;
    let forwarded = 0;
    const activateGateway = () => {
      if (typeof approvedGateway === "function") return approvedGateway();
      const account = syntheticGatewayAccount();
      return new HostSubscriptionGateway(
        syntheticGatewayApproval(deliveryId, account),
        () => account,
        async (token, body, signal) => {
          if (
            token !== account.accessToken ||
            body !== gatewayRequest ||
            signal.aborted
          )
            throw Error("Invalid synthetic upstream");
          forwarded++;
          return syntheticGatewayResponse();
        },
      );
    };
    const stream = this.management.openCodex({
      ...payload,
      gatewayCapability: transportCapability,
      gatewayVersion: subscriptionGatewayVersion,
    });
    const child = stream.child;
    let pending = "",
      bytes = 0,
      result: any,
      failure = false;
    let processing = Promise.resolve();
    const refuse = () => {
      failure = true;
      gateway?.revoke();
      child.stdin.end();
      child.kill();
    };
    const timer = setTimeout(refuse, stream.deadlineMs);
    child.stdin.on("error", refuse);
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1048576) refuse();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      pending += chunk.toString("utf8");
      if (bytes > 1048576 || pending.length > 131072) return refuse();
      while (pending.includes("\n")) {
        const index = pending.indexOf("\n"),
          line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        processing = processing
          .then(async () => {
            const frame = JSON.parse(line);
            if (
              Object.keys(frame).sort().join(",") ===
              "capability,deliveryId,gatewayRequest"
            ) {
              if (
                frame.deliveryId !== deliveryId ||
                typeof frame.capability !== "string" ||
                Buffer.byteLength(frame.capability) !== 64 ||
                !timingSafeEqual(
                  Buffer.from(frame.capability),
                  Buffer.from(transportCapability),
                ) ||
                typeof frame.gatewayRequest !== "string" ||
                frame.gatewayRequest.length > 87384
              )
                throw Error();
              const raw = Buffer.from(frame.gatewayRequest, "base64");
              if (raw.toString("base64") !== frame.gatewayRequest)
                throw Error();
              gateway ??= activateGateway();
              const response = await gateway.respond(
                deliveryId,
                gateway.capability,
                raw.toString("utf8"),
              );
              child.stdin.write(
                JSON.stringify({
                  gatewayResponse: response.toString("base64"),
                  deliveryId,
                }) + "\n",
              );
            } else {
              if (result !== undefined) throw Error();
              result = frame;
            }
          })
          .catch(refuse);
      }
    });
    try {
      const closed = new Promise<number | null>((resolve, reject) => {
        child.once("close", resolve);
        child.once("error", reject);
      });
      stream.start();
      const status = await closed;
      await processing;
      if (failure || status !== 0 || pending || !result || !stream.unchanged())
        throw Error("Gateway transport unavailable");
      if (
        !result.blockedStage &&
        ((!approvedGateway && forwarded !== 1) ||
          result.gatewayIntegration !== "passed" ||
          result.gatewayVersion !== subscriptionGatewayVersion)
      )
        throw Error("Unverified gateway integration");
      return result;
    } finally {
      clearTimeout(timer);
      gateway?.revoke();
      if (child.exitCode === null) child.kill();
    }
  }
  private policy(repository?: string): Record<string, string> {
    if (
      repository &&
      (contains(realpathSync(repository), resolve(this.authorityDirectory)) ||
        contains(resolve(this.authorityDirectory), realpathSync(repository)))
    )
      throw Error("Keep native authority separate from candidate");
    ordinary(this.policyPath);
    if (
      lstatSync(this.policyPath).size > 65536 ||
      contains(
        resolve(this.authorityDirectory),
        realpathSync(this.policyPath),
      ) ||
      (repository &&
        contains(realpathSync(repository), realpathSync(this.policyPath)))
    )
      throw Error("Untrusted native pins");
    const policy = JSON.parse(readFileSync(this.policyPath, "utf8"));
    if (
      policy.schema !== 1 ||
      !policy.binding ||
      Object.keys(policy).some((k) => !["schema", "binding"].includes(k))
    )
      throw Error("Invalid native pins");
    return policy.binding;
  }
  pin(repository: string): PodmanObservation {
    const target = resolve(this.policyPath);
    if (
      contains(realpathSync(repository), resolve(this.authorityDirectory)) ||
      contains(resolve(this.authorityDirectory), realpathSync(repository)) ||
      contains(realpathSync(repository), target) ||
      contains(resolve(this.authorityDirectory), target)
    )
      throw Error("Keep native pins outside candidate and authority");
    mkdirSync(dirname(target), { recursive: true });
    ordinary(dirname(target), true);
    const observation = this.invoke("enroll");
    writeFileSync(
      target,
      JSON.stringify({ schema: 1, binding: observation.binding }, null, 2) +
        "\n",
      { flag: "wx", mode: 0o600, flush: true },
    );
    return observation;
  }
  observe(repository: string): PodmanObservation {
    return this.invoke("observe", { expected: this.policy(repository) });
  }
  async probeIsolation(
    repository: string,
    deliveryId: string = randomUUID(),
  ): Promise<any> {
    const expected = this.policy(repository);
    const evidence = await withHostCanary(
      async (challenge) => {
        const observed = this.invoke("isolate", { expected, challenge });
        if (observed.challengeId !== challenge.id)
          throw Error("Unbound isolation evidence");
        if (
          observed.passed === true &&
          codexWorkerSha256(expected.platform!, expected.arch!)
        ) {
          const codex = await this.gatewayInvocation(
            { expected, challenge, deliveryId },
            deliveryId,
          );
          if (codex.blockedStage) {
            observed.codex = {
              blockedStage: codex.blockedStage,
              diagnostic: nativeProbeDiagnostic(codex.diagnostic),
            };
          } else if (
            codex.protocol !== "passed" ||
            codex.explicitResume !== "passed" ||
            codex.resumeInferenceRequests !== 0 ||
            codex.credentialIsolation !== "passed" ||
            codex.shutdown?.remainingProcesses !== 0 ||
            codex.observedCodexProcesses < 1 ||
            JSON.stringify(codex.binding) !== JSON.stringify(expected)
          )
            throw Error("Unverified Codex worker");
          if (!codex.blockedStage) observed.codex = codex;
        }
        return {
          ...observed,
          probeVersion: sha256(vmManagementVersion + hostCanaryVersion),
        };
      },
      expected.platform === "darwin" ? 120000 : 25000,
    );
    if (evidence.passed === true) {
      const body = JSON.stringify({
        model: "gpt-6.1-sol",
        input: [
          {
            role: "user",
            content: "Say exactly: AIOS model-only inference complete",
          },
        ],
        store: false,
        stream: true,
      });
      this.modelFrame(repository, "request", body);
      this.modelFrame(
        repository,
        "response",
        "AIOS model-only inference complete",
      );
      evidence.modelFrameTransport = "passed";
    }
    return evidence;
  }
  /** Explicit owner-approved one-shot only. The gateway never serializes its
   * account callback/token: only its disposable capability enters management. */
  async inferThroughGateway(
    repository: string,
    deliveryId: string,
    approvedGateway: HostSubscriptionGateway | (() => HostSubscriptionGateway),
  ): Promise<any> {
    let gateway =
      typeof approvedGateway === "function" ? undefined : approvedGateway;
    try {
      const expected = this.policy(repository);
      const proof = await withHostCanary(
        async (challenge) => {
          const isolation = this.invoke("isolate", { expected, challenge });
          if (
            isolation.passed !== true ||
            isolation.challengeId !== challenge.id
          )
            throw Error("Unverified isolation");
          const codex = await this.gatewayInvocation(
            { expected, challenge, deliveryId },
            deliveryId,
            () => {
              gateway ??= (approvedGateway as () => HostSubscriptionGateway)();
              return gateway;
            },
          );
          if (
            codex.protocol !== "passed" ||
            codex.explicitResume !== "passed" ||
            codex.resumeInferenceRequests !== 0 ||
            codex.credentialIsolation !== "passed" ||
            codex.gatewayIntegration !== "passed" ||
            codex.relayDeliveryId !== deliveryId ||
            codex.shutdown?.remainingProcesses !== 0 ||
            codex.relayShutdownRemaining !== 0 ||
            JSON.stringify(codex.binding) !== JSON.stringify(expected)
          )
            throw Error("Unverified inference bridge");
          return codex;
        },
        expected.platform === "darwin" ? 120000 : 25000,
      );
      return proof;
    } finally {
      gateway?.revoke();
    }
  }
  /** Fixed synthetic request/result transport only, not a production worker. */
  modelFrame(
    repository: string,
    frameMode: "request" | "response",
    frame: string,
  ): any {
    if (Buffer.byteLength(frame) > 4096) throw Error("Model frame too large");
    const expected = this.policy(repository);
    const observed = this.invoke("model-frame", {
      expected,
      frameMode,
      frame: Buffer.from(frame).toString("base64"),
    });
    if (
      JSON.stringify(observed.binding) !== JSON.stringify(expected) ||
      observed.frame !== Buffer.from(frame).toString("base64") ||
      observed.shutdown?.remainingProcesses !== 0
    )
      throw Error("Unverified model frame");
    return observed;
  }
  async execute(
    request: Parameters<OfflineCanaryRuntime["execute"]>[0],
  ): Promise<CanaryExecution> {
    this.session(request.session);
    if (
      !request.mayDispatch() ||
      request.files.length !== 1 ||
      request.files[0]?.path !== "canary.txt" ||
      !request.files[0].bytes.equals(Buffer.from(canaryInput))
    )
      throw Error("Native dispatch refused");
    const expected = this.policy();
    if (
      Object.keys(expected).length !== Object.keys(request.binding).length ||
      Object.entries(expected).some(
        ([key, value]) => request.binding[key] !== value,
      ) ||
      sha256(readFileSync(this.policyPath)) !== request.policySha256
    )
      throw Error("Changed native pins");
    return this.invoke("execute", {
      expected,
      session: request.session,
      pins: {
        bindingSha256: request.bindingSha256,
        policySha256: request.policySha256,
      },
      input: request.files[0].bytes.toString("base64"),
    });
  }
  async stop(session: WorkerSession, pins: CanaryPins): Promise<CanaryStop> {
    this.session(session);
    return this.invoke("stop", { session, pins });
  }
  async collect(
    session: WorkerSession,
    pins: CanaryPins,
  ): Promise<CanaryCollection> {
    this.session(session);
    const result = this.invoke("collect", { session, pins });
    if (!matchesCanary(result, session, pins) || result.status !== "stopped")
      throw Error("Mismatched native collection");
    const bytes = Buffer.from(result.content, "base64");
    if (!bytes.equals(Buffer.from(canaryOutput)))
      throw Error("Invalid native output");
    const spool = join(
      this.authorityDirectory,
      "artifacts",
      `${session.sandboxId}-native-result.txt`,
    );
    ordinary(dirname(spool), true);
    writeFileSync(spool, bytes, { flag: "wx", mode: 0o600, flush: true });
    ordinary(spool);
    const before = sha256(readFileSync(spool));
    const after = sha256(readFileSync(spool));
    if (before !== result.beforeSha256 || after !== result.afterSha256)
      throw Error("Changed native spool");
    return {
      ...result,
      files: [
        {
          path: "result.txt",
          bytes,
          ordinary: true,
          links: lstatSync(spool).nlink,
          beforeSha256: before,
          afterSha256: after,
        },
      ],
    };
  }
  private session(session: WorkerSession): void {
    for (const key of [
      "deliveryId",
      "operationId",
      "sandboxId",
      "workerSessionId",
      "runnerId",
    ] as const)
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          session[key],
        )
      )
        throw Error("Invalid native identity");
    if (!Number.isSafeInteger(session.fence) || session.fence < 1)
      throw Error("Invalid native fence");
  }
}
