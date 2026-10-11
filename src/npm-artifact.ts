import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { request } from "node:https";
import {
  assertPrivateAuthStorage,
  assertOwnerControlledStorage,
} from "./subscription-auth.js";
import type {
  OnlineAccessRuntime,
  OnlineDependency,
  OnlinePlan,
  OnlineProof,
  OnlineStop,
} from "./online-access.js";

export type ArtifactReader = (
  url: string,
  signal: AbortSignal,
) => Promise<{ status: number; bytes: Buffer; encoding?: string }>;
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const maximum = 8 * 1024 * 1024;
const pending = new Map<string, AbortController>();
const httpsArtifact: ArtifactReader = (url, signal) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "GET", signal, headers: { "accept-encoding": "identity" } },
      (res) => {
        if (
          res.statusCode !== 200 ||
          (res.headers["content-encoding"] &&
            res.headers["content-encoding"] !== "identity")
        ) {
          res.destroy();
          reject(Error("Artifact refused"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximum) res.destroy(Error("Artifact refused"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({ status: 200, bytes: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

/** Host-owned npm-only artifact admission. Pins are outside the repository;
 * no metadata discovery, redirects, installs, archive extraction or scripts.
 * Exact bytes, independent policy and usage authority are checked again before
 * handoff. Its capability does not authorize a model request or arbitrary URL. */
export class NpmArtifactRuntime implements OnlineAccessRuntime {
  readonly mode;
  readonly version;
  constructor(
    private readonly inner: OnlineAccessRuntime,
    private readonly policyPath: string,
    private readonly reader: ArtifactReader = httpsArtifact,
  ) {
    this.mode = inner.mode;
    this.version = digest(
      readFileSync(new URL(import.meta.url)) +
        "\n" +
        (inner.version ?? "controlled-observation"),
    );
  }
  dependencyPlan(repository: string): OnlineDependency {
    if (
      !isAbsolute(this.policyPath) ||
      realpathSync(this.policyPath) !== resolve(this.policyPath)
    )
      throw Error("Invalid artifact policy");
    const rel = relative(realpathSync(repository), this.policyPath);
    if (
      rel === "" ||
      (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
    )
      throw Error("Candidate artifact policy refused");
    assertOwnerControlledStorage(
      dirname(this.policyPath),
      "directory",
      4096,
      "readable",
    );
    assertPrivateAuthStorage(this.policyPath, "file", 65536);
    const bytes = readFileSync(this.policyPath),
      r = JSON.parse(bytes.toString());
    if (
      r.schema !== 1 ||
      r.registry !== "https://registry.npmjs.org" ||
      typeof r.artifact?.path !== "string" ||
      !/^\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/-\/[a-z0-9._-]+\.tgz$/.test(
        r.artifact.path,
      ) ||
      r.artifact.path
        .split("/")
        .some((part: string) => part === ".." || part === ".") ||
      !/^[a-f0-9]{64}$/.test(r.artifact.sha256 ?? "") ||
      !Number.isSafeInteger(r.artifact.bytes) ||
      r.artifact.bytes < 1 ||
      r.artifact.bytes > maximum
    )
      throw Error("Invalid npm artifact policy");
    return {
      registry: r.registry,
      path: r.artifact.path,
      artifactSha256: r.artifact.sha256,
      bytes: r.artifact.bytes,
      policySha256: digest(bytes),
      transport: this.reader === httpsArtifact ? "https" : "controlled",
    };
  }
  async execute(
    plan: OnlinePlan,
    authorize: () => Promise<boolean>,
  ): Promise<OnlineProof> {
    const pinned = this.dependencyPlan(plan.repository);
    if (
      !plan.dependency ||
      JSON.stringify(pinned) !== JSON.stringify(plan.dependency) ||
      plan.runtimeVersion !== this.version ||
      !(await authorize())
    )
      throw Error("Changed artifact authority");
    const cancellation = new AbortController();
    pending.set(plan.runId, cancellation);
    const deadline = setTimeout(() => cancellation.abort(), 5000);
    let artifact;
    try {
      artifact = await this.reader(
        pinned.registry + pinned.path,
        cancellation.signal,
      );
      if (
        cancellation.signal.aborted ||
        artifact.status !== 200 ||
        (artifact.encoding && artifact.encoding !== "identity") ||
        !Buffer.isBuffer(artifact.bytes) ||
        artifact.bytes.length !== pinned.bytes ||
        digest(artifact.bytes) !== pinned.artifactSha256 ||
        JSON.stringify(this.dependencyPlan(plan.repository)) !==
          JSON.stringify(pinned) ||
        !(await authorize())
      )
        throw Error("Artifact refused");
    } finally {
      clearTimeout(deadline);
      pending.delete(plan.runId);
    }
    return this.inner.execute(
      {
        ...plan,
        runtimeVersion: this.inner.version ?? "controlled-observation",
      },
      authorize,
      { bytes: Buffer.from(artifact.bytes), sha256: pinned.artifactSha256 },
    );
  }
  async stop(runId: string): Promise<OnlineStop> {
    pending.get(runId)?.abort();
    return this.inner.stop(runId);
  }
}
