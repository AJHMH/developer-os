import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WorkerSession } from "./controller.js";
import {
  sha256,
  type CanaryPins,
  type OfflineCanaryRuntime,
} from "./offline-canary.js";
import { NativePodmanDriver } from "./podman-native.js";
export const syntheticSiteInput =
  "<!doctype html><title>Developer OS fixture</title><h1>Before</h1>\n";
export const syntheticSiteOutput =
  "<!doctype html><title>Developer OS fixture</title><h1>Ready</h1>\n";
export const syntheticSiteValidator =
  "#!/bin/sh\nset -eu\ngrep -q '<h1>Ready</h1>' index.html\ngrep -q '<title>Developer OS fixture</title>' index.html\n";
export const syntheticTaskVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
export interface SyntheticTaskResult {
  operationId: string;
  version: string;
  inputSha256: string;
  outputSha256: string;
  output: string;
  validation: "passed";
  negativeValidation: "passed";
  httpValidation: "passed";
  collectionSha256: string;
}
export interface SyntheticTaskRuntime extends OfflineCanaryRuntime {
  readonly version: string;
  stage(files: { path: string; bytes: Buffer }[]): void;
  collectTask(
    session: WorkerSession,
    pins: CanaryPins,
  ): Promise<SyntheticTaskResult>;
}
export interface SyntheticTaskEvidence extends CanaryPins {
  mode: "live" | "controlled";
  version: string;
  outcome: "completed" | "refused";
  session?: WorkerSession;
  result?: SyntheticTaskResult;
  shutdownProof?: { remainingProcesses: number; censusSha256: string };
  productionEnabled: false;
}

/** Fixed disposable HTML edit and repository-script validation only; no inference. */
export class NativeSyntheticTask implements SyntheticTaskRuntime {
  readonly mode = "live" as const;
  readonly version = syntheticTaskVersion;
  private files: { path: string; bytes: Buffer }[] | undefined;
  private collectionKey: string | undefined;
  constructor(private readonly native: NativePodmanDriver) {}
  stage(files: { path: string; bytes: Buffer }[]) {
    if (
      files.length !== 2 ||
      files[0]?.path !== "index.html" ||
      files[1]?.path !== "validate.sh" ||
      files[0].bytes.toString() !== syntheticSiteInput ||
      files[1].bytes.toString() !== syntheticSiteValidator
    )
      throw Error("Only the fixed synthetic site is admitted");
    this.files = files.map((f) => ({
      path: f.path,
      bytes: Buffer.from(f.bytes),
    }));
    this.collectionKey = undefined;
  }
  private invoke(action: string, session: WorkerSession, pins: CanaryPins) {
    if (
      !/^[a-f0-9-]{36}$/.test(session.sandboxId) ||
      !/^[a-f0-9-]{36}$/.test(session.operationId)
    )
      throw Error("Invalid synthetic session");
    const request = {
      session,
      pins,
      version: this.version,
      expected: Buffer.from(syntheticSiteOutput).toString("base64"),
      files: this.files?.map((file) => ({
        path: file.path,
        bytes: file.bytes.toString("base64"),
      })),
    };
    return action === "execute"
      ? this.native.taskExecute(request)
      : this.native.taskCollect(request);
  }
  async execute(request: Parameters<OfflineCanaryRuntime["execute"]>[0]) {
    if (!this.files || !request.mayDispatch())
      throw Error("Synthetic input or ownership missing");
    const response = await this.native.execute(request);
    if (!request.mayDispatch()) throw Error("Synthetic task authority changed");
    this.invoke("execute", request.session, {
      bindingSha256: request.bindingSha256,
      policySha256: request.policySha256,
    });
    return response;
  }
  stop(session: WorkerSession, pins: CanaryPins) {
    return this.native.stop(session, pins);
  }
  async collect(session: WorkerSession, pins: CanaryPins) {
    const collection = await this.native.collect(session, pins);
    this.collectionKey = sha256(JSON.stringify({ session, pins }));
    return collection;
  }
  async collectTask(
    session: WorkerSession,
    pins: CanaryPins,
  ): Promise<SyntheticTaskResult> {
    const exactPins = {
      bindingSha256: pins.bindingSha256,
      policySha256: pins.policySha256,
    };
    // Native collection creates an exclusive spool and must run exactly once.
    // The controller completed that collection before accepting this task result.
    if (
      this.collectionKey !==
      sha256(JSON.stringify({ session, pins: exactPins }))
    )
      throw Error(
        "Synthetic task requires matching verified native collection",
      );
    return this.invoke("collect", session, exactPins);
  }
}
