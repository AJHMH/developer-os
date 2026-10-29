import { createHash } from "node:crypto";
import { Agent, request as httpsRequest } from "node:https";

/** The controlled dependency phase's prepared npm cache (owner decisions, 29
 * October): the candidate's lockfile, read only as data on the host, names
 * the exact registry tarballs; the host fetches and verifies each against its
 * sha512 integrity; the worker installs from them offline, so dependency
 * scripts run only inside isolation. Nothing here executes candidate code. */
export const npmRegistry = "https://registry.npmjs.org" as const;

export const dependencyCacheLimits = Object.freeze({
  lockfileBytes: 16 * 1024 * 1024,
  artifacts: 2048,
  artifactBytes: 64 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  artifactMs: 60_000,
});

export interface NpmCacheArtifact {
  /** Registry path of the tarball, e.g. `/@scope/name/-/name-1.0.0.tgz`. */
  path: string;
  /** Hex sha512 of the tarball, from the lockfile's integrity. */
  sha512: string;
}
export interface NpmCachePlan {
  registry: typeof npmRegistry;
  lockfileSha256: string;
  /** Sorted by path, one entry per tarball. */
  artifacts: NpmCacheArtifact[];
  planSha256: string;
}
export interface NpmCache {
  planSha256: string;
  /** Content-addressed `<sha512>.tgz` files, in plan order. */
  files: { path: string; bytes: Buffer }[];
  bytes: number;
}
/** Reads one registry URL without following redirects, giving up past
 * `maxBytes` and when `signal` aborts. */
export type RegistryReader = (
  url: string,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<{ status: number; bytes: Buffer; encoding?: string }>;

const sha = (algorithm: string, value: string | Buffer) =>
  createHash(algorithm).update(value).digest("hex");
const tarballPath =
  /^\/(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+\/-\/[A-Za-z0-9._~-]+\.tgz$/;
/** A registry tarball path that URL parsing leaves unchanged, so it has no
 * dot segments. */
const registryTarball = (path: unknown): path is string =>
  typeof path === "string" &&
  tarballPath.test(path) &&
  new URL(npmRegistry + path).pathname === path;
function refuseLockfile(): never {
  throw Error("Unsupported dependency lockfile");
}
function refuseCache(reason: string): never {
  throw Error(`Dependency cache refused: ${reason}`);
}
/** Rejects once `signal` aborts, so a reader that ignores it cannot hang. */
const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const planDigest = (plan: Omit<NpmCachePlan, "planSha256">) =>
  sha(
    "sha256",
    JSON.stringify({
      registry: plan.registry,
      lockfileSha256: plan.lockfileSha256,
      artifacts: plan.artifacts.map(({ path, sha512 }) => ({ path, sha512 })),
    }),
  );

/** The registry path of a `resolved` URL, or undefined unless it is exactly
 * an https tarball on the declared registry. Requiring the text to equal the
 * registry origin plus its parsed path also refuses credentials, ports,
 * queries, fragments, encodings and dot segments, which parsing would change
 * or drop. */
function registryPath(resolved: unknown): string | undefined {
  if (typeof resolved !== "string" || !resolved.startsWith(npmRegistry + "/"))
    return undefined;
  // A string starting with the registry origin always parses.
  const { pathname } = new URL(resolved);
  return npmRegistry + pathname === resolved && registryTarball(pathname)
    ? pathname
    : undefined;
}
/** The hex sha512 among an integrity string's hashes, if well formed. A
 * real integrity is a few hashes; a longer one is refused before splitting. */
function sha512Of(integrity: unknown): string | undefined {
  if (typeof integrity !== "string" || integrity.length > 1024)
    return undefined;
  for (const token of integrity.split(/\s+/)) {
    if (!token.startsWith("sha512-")) continue;
    const bytes = Buffer.from(token.slice(7), "base64");
    if (bytes.length === 64 && bytes.toString("base64") === token.slice(7))
      return bytes.toString("hex");
  }
  return undefined;
}

/** The bounded fetch plan for a candidate's `package-lock.json` (version 2
 * or 3). Every installed package must resolve to a registry tarball with
 * sha512 integrity; bundled packages arrive inside their parent. Workspace
 * links, git, file and other-registry sources are refused. */
export function npmCachePlan(lockfile: Buffer): NpmCachePlan {
  if (
    !Buffer.isBuffer(lockfile) ||
    lockfile.length > dependencyCacheLimits.lockfileBytes
  )
    refuseLockfile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockfile.toString("utf8"));
  } catch {
    refuseLockfile();
  }
  if (
    !object(parsed) ||
    ![2, 3].includes(parsed.lockfileVersion as number) ||
    !object(parsed.packages)
  )
    refuseLockfile();
  const byPath = new Map<string, string>();
  for (const [key, value] of Object.entries(
    (parsed as { packages: Record<string, unknown> }).packages,
  )) {
    if (key === "") continue;
    // Workspace links and git or file sources never resolve to a registry
    // tarball, so the resolved check below refuses them.
    if (!key.startsWith("node_modules/") || !object(value)) refuseLockfile();
    if (value.inBundle === true) continue;
    const path = registryPath(value.resolved),
      sha512 = sha512Of(value.integrity);
    if (!path || !sha512 || (byPath.get(path) ?? sha512) !== sha512)
      refuseLockfile();
    byPath.set(path, sha512);
    if (byPath.size > dependencyCacheLimits.artifacts) refuseLockfile();
  }
  const artifacts = [...byPath]
    // Paths are unique keys, so no two compare equal.
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, sha512]) => ({ path, sha512 }));
  const plan = {
    registry: npmRegistry,
    lockfileSha256: sha("sha256", lockfile),
    artifacts,
  };
  return { ...plan, planSha256: planDigest(plan) };
}

/** Fetch exactly the plan's tarballs from the declared registry through
 * `reader` and admit them only if every one matches its sha512, within the
 * size, total and time bounds. Any refusal admits nothing. */
export async function fetchNpmCache(
  plan: NpmCachePlan,
  options: {
    reader: RegistryReader;
    signal?: AbortSignal;
    totalBytes?: number;
  },
): Promise<NpmCache> {
  if (
    !object(plan) ||
    plan.registry !== npmRegistry ||
    !/^[a-f0-9]{64}$/.test(plan.lockfileSha256) ||
    !Array.isArray(plan.artifacts) ||
    plan.artifacts.length > dependencyCacheLimits.artifacts ||
    plan.artifacts.some(
      (a) =>
        !object(a) ||
        !registryTarball(a.path) ||
        !/^[a-f0-9]{128}$/.test(a.sha512),
    ) ||
    planDigest(plan) !== plan.planSha256
  )
    refuseCache("plan");
  const total = Math.min(
    options.totalBytes ?? dependencyCacheLimits.totalBytes,
    dependencyCacheLimits.totalBytes,
  );
  const files: NpmCache["files"] = [];
  let read = 0;
  for (const artifact of plan.artifacts) {
    if (options.signal?.aborted) refuseCache("cancelled");
    const signal = AbortSignal.any([
      AbortSignal.timeout(dependencyCacheLimits.artifactMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    let response: Awaited<ReturnType<RegistryReader>>;
    try {
      // Never more than one tarball's bound or what is left of the total.
      const reading = options.reader(
        npmRegistry + artifact.path,
        signal,
        Math.min(dependencyCacheLimits.artifactBytes, total - read),
      );
      reading.catch(() => {});
      response = await Promise.race([reading, aborted(signal)]);
    } catch {
      refuseCache(signal.aborted ? "cancelled" : "unavailable");
    }
    if (signal.aborted) refuseCache("cancelled");
    if (
      response.status !== 200 ||
      (response.encoding !== undefined && response.encoding !== "identity") ||
      !Buffer.isBuffer(response.bytes)
    )
      refuseCache("response");
    const body = Buffer.from(response.bytes);
    if (
      body.length > dependencyCacheLimits.artifactBytes ||
      (read += body.length) > total
    )
      refuseCache("size");
    if (sha("sha512", body) !== artifact.sha512) refuseCache("integrity");
    // One tarball reached through two paths is one cache file.
    if (!files.some((f) => f.path === `${artifact.sha512}.tgz`))
      files.push({ path: `${artifact.sha512}.tgz`, bytes: body });
  }
  return {
    planSha256: plan.planSha256,
    files,
    bytes: files.reduce((n, f) => n + f.bytes.length, 0),
  };
}

/** The registry reader the host uses: one https GET of a registry tarball,
 * asking for identity encoding, never following a redirect (the status is
 * returned and refused by the fetch), and giving up past `maxBytes` or when
 * `signal` aborts. Any other URL is refused before connecting. `request` is
 * injectable for tests. */
export function httpsRegistryReader(
  request: typeof httpsRequest = httpsRequest,
): RegistryReader {
  return (url, signal, maxBytes) =>
    new Promise((resolve, reject) => {
      const refused = () => Error("Registry read refused");
      if (
        !url.startsWith(npmRegistry + "/") ||
        !registryTarball(url.slice(npmRegistry.length))
      ) {
        reject(refused());
        return;
      }
      const req = request(
        url,
        {
          method: "GET",
          signal,
          headers: { "accept-encoding": "identity" },
          // Its own connection and certificate checking: no global agent,
          // environment proxy or disabled verification applies.
          agent: new Agent({ keepAlive: false }),
          rejectUnauthorized: true,
        },
        (res) => {
          const encoding = res.headers["content-encoding"];
          if (
            res.statusCode !== 200 ||
            (encoding !== undefined && encoding !== "identity")
          ) {
            res.destroy();
            resolve({
              status: Number(res.statusCode),
              bytes: Buffer.alloc(0),
              ...(encoding ? { encoding: String(encoding) } : {}),
            });
            return;
          }
          if (Number(res.headers["content-length"]) > maxBytes) {
            res.destroy();
            reject(refused());
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) res.destroy(refused());
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
}
