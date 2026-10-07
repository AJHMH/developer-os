import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { redact } from "./redaction.js";
import type { WorkerPolicy } from "./sandbox-worker.js";
export function admittedPath(path: string): boolean {
  return Boolean(
    path &&
      !path.includes("\\") &&
      !path.includes(":") &&
      path
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            !/[\u0000-\u001f\u007f]/.test(part) &&
            !/[. ]$/.test(part) &&
            !/^(?:\.git|\.env(?:\..*)?|\.ssh|\.gnupg|\.aws|\.codex|\.agents|\.claude|\.npmrc|\.mcp\.json|sbxenv\.ya?ml)$/i.test(
              part,
            ) &&
            !/\.(?:pem|key|p12|pfx)$/i.test(part) &&
            !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ),
  );
}
function ordinary(path: string, directory: boolean): void {
  const entry = lstatSync(path),
    canonical = realpathSync(path);
  const same =
    process.platform === "win32"
      ? canonical.toLowerCase() === resolve(path).toLowerCase()
      : canonical === resolve(path);
  if (
    entry.isSymbolicLink() ||
    !same ||
    (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)
  )
    throw Error("Only admitted ordinary entries are allowed");
}
export function admitFiles(
  policy: WorkerPolicy,
  repository: string,
): { path: string; bytes: Buffer; executable: boolean }[] {
  const names = new Set<string>();
  let total = 0;
  return policy.files.map((file) => {
    const normalized = file.path.toLowerCase();
    if (!admittedPath(file.path) || names.has(normalized))
      throw Error("Unsafe admitted path");
    names.add(normalized);
    ordinary(repository, true);
    let path = repository;
    const parts = file.path.split("/");
    for (const part of parts.slice(0, -1)) {
      path = join(path, part);
      ordinary(path, true);
    }
    path = join(path, parts.at(-1)!);
    ordinary(path, false);
    const before = lstatSync(path);
    if (
      before.size > 16 * 1024 * 1024 ||
      (total += before.size) > 128 * 1024 * 1024
    )
      throw Error("Workspace admission size exceeded");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const opened = fstatSync(fd);
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size
      )
        throw Error("Source changed during admission");
      bytes = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
    if (
      createHash("sha256").update(bytes).digest("hex") !== file.sha256 ||
      redact(bytes.toString("utf8")) !== bytes.toString("utf8")
    )
      throw Error(
        "Source digest changed or credential-like content is present",
      );
    return { path: file.path, bytes, executable: Boolean(before.mode & 0o111) };
  });
}
export function materializeWorkspace(
  policy: WorkerPolicy,
  repository: string,
): { path: string; manifestSha256: string } {
  const files = admitFiles(policy, repository);
  ordinary(policy.workspaceDirectory, true);
  const path = mkdtempSync(join(policy.workspaceDirectory, "aios-"));
  for (const file of files) {
    const target = join(path, ...file.path.split("/"));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file.bytes, {
      flag: "wx",
      mode: file.executable ? 0o700 : 0o600,
      flush: true,
    });
  }
  return {
    path,
    manifestSha256: createHash("sha256")
      .update(JSON.stringify(policy.files))
      .digest("hex"),
  };
}
