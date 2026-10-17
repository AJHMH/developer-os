import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DeliveryController, type Delivery } from "./controller.js";
import { sha256, type OfflineCanaryRuntime } from "./offline-canary.js";
import { PodmanHostAdapter } from "./podman-host.js";
import { NativePodmanDriver } from "./podman-native.js";
import { podmanMachine } from "./podman-platform.js";
import {
  hostControlNames,
  hostControlsVersion,
  type HostControlsEvidence,
  type HostControlsRuntime,
} from "./windows-controls.js";
const crash = String.raw`
let text='';for await(const chunk of process.stdin)text+=chunk;
const r=JSON.parse(text);
const {DeliveryController}=await import(r.controller);
const {NativePodmanDriver}=await import(r.native);
const {PodmanHostAdapter}=await import(r.host);
const n=new NativePodmanDriver(r.machine,r.state,r.policy);
const w=new PodmanHostAdapter({machine:r.machine,policyPath:r.policy,native:n});
const o={mode:'live',execute:async request=>{await n.execute(request);console.log('AIOS_ACCEPTED');await new Promise(()=>setInterval(()=>{},1000));},stop:(s,p)=>n.stop(s,p),collect:(s,p)=>n.collect(s,p)};
await new DeliveryController(r.state,{}, {worker:w,offline:o}).offlineCanary(r.id);
`;
/** Exercises actual public controller lifecycle against a dedicated native VM.
 * All fixtures contain generated tokens, never owner signing/publication keys. */
export class NativeHostControls implements HostControlsRuntime {
  readonly version = hostControlsVersion;
  readonly mode = "live" as const;
  constructor(private readonly native: NativePodmanDriver) {}
  async qualify(delivery: Delivery): Promise<HostControlsEvidence> {
    const n = this.native,
      id = delivery.id;
    const worker = new PodmanHostAdapter({
      machine: n.machine,
      policyPath: n.policyPath,
      native: n,
    });
    const controller = (offline: OfflineCanaryRuntime = n) =>
      new DeliveryController(n.authorityDirectory, {}, { worker, offline });
    const c = controller(),
      checks: HostControlsEvidence["checks"] = [],
      censuses: HostControlsEvidence["censuses"] = [];
    const record = (d: Delivery) => {
      const census = d.offlineCanary?.shutdownProof;
      if (
        d.execution?.state !== "stopped" ||
        !census ||
        census.observedProcesses < 8 ||
        census.remainingProcesses !== 0 ||
        !/^[a-f0-9]{64}$/.test(census.censusSha256)
      )
        throw Error("Unverified host shutdown");
      censuses.push(census);
    };
    let request: Parameters<OfflineCanaryRuntime["execute"]>[0] | undefined;
    let boundary: any;
    const probe: OfflineCanaryRuntime = {
      mode: "live",
      execute: async (r) => {
        request = r;
        const result = await n.execute(r);
        if (!r.mayDispatch()) throw Error("Boundary authority changed");
        const challenge = randomUUID();
        boundary = n.boundaryProbe({
          challenge,
          session: r.session,
          pins: {
            bindingSha256: r.bindingSha256,
            policySha256: r.policySha256,
          },
        });

        if (
          boundary.challenge !== challenge ||
          boundary.operationId !== r.session.operationId ||
          boundary.positiveControls !== true ||
          boundary.privilegedDenial !== true ||
          JSON.stringify(boundary.names) !==
            JSON.stringify(hostControlNames.slice(0, 3))
        )
          throw Error("Unverified boundary observation");
        return result;
      },
      stop: (s, p) => n.stop(s, p),
      collect: (s, p) => n.collect(s, p),
    };
    const first = await controller(probe).offlineCanary(id);
    record(first);
    if (first.offlineCanary?.outcome !== "completed" || !boundary || !request)
      throw Error("Boundary task refused");
    for (const name of hostControlNames.slice(0, 3))
      checks.push({
        name,
        evidenceSha256: sha256(
          JSON.stringify({ name, boundary, census: censuses[0] }),
        ),
      });
    const contender = c.start({
      repository: delivery.repository,
      request: "Fixed Windows competing-owner probe",
    });
    if (
      contender.ownership.held ||
      contender.phase !== "queued" ||
      contender.execution
    )
      throw Error("Competing owner dispatched");
    await c.cancel(contender.id);
    let denied = false;
    try {
      await n.execute({ ...request, mayDispatch: () => true });
    } catch {
      denied = true;
    }
    if (!denied) throw Error("Revoked sender admitted");
    checks.push({
      name: "repository-fencing",
      evidenceSha256: sha256(
        JSON.stringify({
          contender: contender.id,
          session: first.execution,
          revokedSenderDenied: denied,
        }),
      ),
    });
    const usage = JSON.stringify(c.status(id).usage);
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", crash],
      {
        cwd: podmanMachine(n.machine).cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          ...(process.platform === "darwin"
            ? { HOME: podmanMachine(n.machine).env.HOME }
            : {}),
          SystemRoot: process.env.SystemRoot,
          PATH: process.env.SystemRoot
            ? process.env.SystemRoot + "/System32"
            : "/usr/bin:/bin",
        },
      },
    );
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Crash fixture timed out")),
          60000,
        );
        let output = "";
        child.once("error", () => {
          clearTimeout(timer);
          reject(Error("Crash fixture unavailable"));
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("Crash fixture exited early"));
        });
        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          if (output.length > 8192) {
            clearTimeout(timer);
            reject(Error("Unbounded crash fixture"));
          } else if (output.includes("AIOS_ACCEPTED")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.stdin.end(
          JSON.stringify({
            id,
            state: n.authorityDirectory,
            policy: n.policyPath,
            machine: n.machine,
            controller: new URL("./controller.js", import.meta.url).href,
            native: new URL("./podman-native.js", import.meta.url).href,
            host: new URL("./podman-host.js", import.meta.url).href,
          }),
        );
      });
      child.kill();
      await closed;
      const orphan = c.status(id);
      if (orphan.execution?.state !== "dispatched")
        throw Error("Missing orphan intent");
      let releaseDenied = false;
      try {
        c.release(id);
      } catch {
        releaseDenied = true;
      }
      if (!releaseDenied) throw Error("Orphan ownership released");
      const recovered = await c.recover(id);
      record(recovered);
      if (
        recovered.execution?.operationId !== orphan.execution.operationId ||
        !recovered.ownership.held ||
        JSON.stringify(recovered.usage) !== usage
      )
        throw Error("Orphan recovery changed authority or work");
      checks.push({
        name: "orphan-resume",
        evidenceSha256: sha256(
          JSON.stringify({
            orphan: orphan.execution,
            recovered: recovered.execution,
            shutdown: censuses[1],
            releaseDenied,
          }),
        ),
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await closed;
      }
      const current = c.status(id);
      if (current.execution && current.execution.state !== "stopped")
        await c.recover(id);
    }
    checks.push({
      name: "descendant-stop",
      evidenceSha256: sha256(JSON.stringify(censuses)),
    });
    const final = c.status(id);
    return {
      version: this.version,
      nativeVersion: sha256(
        readFileSync(new URL("./podman-native.js", import.meta.url)),
      ),
      mode: this.mode,
      operationId: final.execution!.operationId,
      outcome: "passed",
      bindingSha256: delivery.qualification!.bindingSha256!,
      policySha256: delivery.qualification!.policySha256!,
      checks,
      censuses,
      productionEnabled: false,
    };
  }
}

export { NativeHostControls as NativeWindowsControls };
