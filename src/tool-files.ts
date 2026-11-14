import { createHash } from "node:crypto";
import { Agent, request as httpsRequest } from "node:https";
import { gunzipSync } from "node:zlib";

/** Owner-pinned tool files (#275): files a repository's install and checks
 * need that npm doesn't carry, such as Prisma's schema engine, which its
 * install downloads from the network. The owner contract names each by an
 * https URL, the SHA-256 of its bytes (after gunzip, when the URL serves a
 * gzip file) and a path under the container's home. The host fetches and
 * verifies each once per attempt; the guest copies them into each install
 * and check container's writable home. Nothing here runs anything. */
export interface ToolFile {
  url: string;
  sha256: string;
  /** Under `$HOME`, e.g. `.cache/prisma/master/<hash>/<platform>/schema-engine`. */
  path: string;
  gzip?: true;
  executable?: true;
}
export const toolFileLimits = Object.freeze({
  files: 32,
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  fileMs: 120_000,
});
/** Reads one https URL without following redirects, giving up past
 * `maxBytes` and when `signal` aborts. */
export type FileReader = (
  url: string,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<{ status: number; bytes: Buffer; encoding?: string }>;
export interface FetchedToolFile {
  sha256: string;
  path: string;
  executable: boolean;
  bytes: Buffer;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** A home-relative path the guest can build a command from: plain names of
 * letters, digits, dots, dashes and underscores, never `.` or `..`. */
export const toolPath = (path: unknown): path is string =>
  typeof path === "string" &&
  path.length <= 200 &&
  /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) &&
  path.split("/").every((part) => part !== "." && part !== "..");
/** An https URL with no credentials, port, query or fragment, which parsing
 * leaves unchanged. */
export function toolUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port &&
    !parsed.search &&
    !parsed.hash &&
    parsed.href === url
  );
}
/** A contract's `toolFiles`: at most 32, with distinct paths. */
export function validToolFiles(value: unknown): value is ToolFile[] {
  return (
    Array.isArray(value) &&
    value.length <= toolFileLimits.files &&
    new Set(value.map((f) => (object(f) ? f.path : undefined))).size ===
      value.length &&
    value.every(
      (f) =>
        object(f) &&
        Object.keys(f).every((k) =>
          ["url", "sha256", "path", "gzip", "executable"].includes(k),
        ) &&
        toolUrl(f.url) &&
        typeof f.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(f.sha256) &&
        toolPath(f.path) &&
        (f.gzip === undefined || f.gzip === true) &&
        (f.executable === undefined || f.executable === true),
    )
  );
}
function refuse(reason: string): never {
  throw Error(`Tool files refused: ${reason}`);
}
const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

/** Fetch every declared tool file through `reader` and admit them only if
 * each matches its SHA-256, within the size, total and time bounds. Any
 * refusal admits nothing. */
export async function fetchToolFiles(
  files: ToolFile[],
  options: { reader: FileReader; signal?: AbortSignal },
): Promise<FetchedToolFile[]> {
  if (!validToolFiles(files)) refuse("declaration");
  const fetched: FetchedToolFile[] = [];
  let total = 0;
  for (const file of files) {
    if (options.signal?.aborted) refuse("cancelled");
    const signal = AbortSignal.any([
      AbortSignal.timeout(toolFileLimits.fileMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    let response: Awaited<ReturnType<FileReader>>;
    try {
      const reading = options.reader(
        file.url,
        signal,
        toolFileLimits.fileBytes,
      );
      reading.catch(() => {});
      response = await Promise.race([reading, aborted(signal)]);
    } catch {
      refuse(signal.aborted ? "cancelled" : "unavailable");
    }
    if (
      response.status !== 200 ||
      (response.encoding !== undefined && response.encoding !== "identity") ||
      !Buffer.isBuffer(response.bytes) ||
      response.bytes.length > toolFileLimits.fileBytes
    )
      refuse("response");
    let bytes: Buffer;
    try {
      bytes = file.gzip
        ? gunzipSync(response.bytes, {
            maxOutputLength: toolFileLimits.fileBytes,
          })
        : Buffer.from(response.bytes);
    } catch {
      refuse("size");
    }
    if ((total += bytes.length) > toolFileLimits.totalBytes) refuse("size");
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      refuse("integrity");
    fetched.push({
      sha256: file.sha256,
      path: file.path,
      executable: file.executable === true,
      bytes,
    });
  }
  return fetched;
}

/** The host's reader: one https GET, asking for identity encoding, never
 * following a redirect (its status is returned and refused by the fetch),
 * giving up past `maxBytes` or when `signal` aborts. Any URL that isn't a
 * plain https URL is refused before connecting. */
export function httpsFileReader(
  request: typeof httpsRequest = httpsRequest,
): FileReader {
  return (url, signal, maxBytes) =>
    new Promise((resolve, reject) => {
      const refused = () => Error("Tool file read refused");
      if (!toolUrl(url)) {
        reject(refused());
        return;
      }
      const req = request(
        url,
        {
          method: "GET",
          signal,
          headers: { "accept-encoding": "identity" },
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
