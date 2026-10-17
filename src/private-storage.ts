import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname } from "node:path";
import { assertWindowsPrivateStorage } from "./windows-auth-store.js";
/** Host storage must be controlled by the effective owner. macOS extended ACLs
 * can grant access beyond mode bits, so an ACL is refused rather than inferred. */
export function assertStorageMetadata(
  path: string,
  kind: "directory" | "file",
  maximum = 4096,
  access: "private" | "readable" = "private",
) {
  const entry = lstatSync(path);
  if (
    entry.isSymbolicLink() ||
    (kind === "directory"
      ? !entry.isDirectory()
      : !entry.isFile() || entry.nlink !== 1 || entry.size > maximum)
  )
    throw Error();
  if (process.platform !== "win32") {
    if (
      !process.geteuid ||
      entry.uid !== process.geteuid() ||
      (entry.mode & (access === "private" ? 0o077 : 0o022)) !== 0
    )
      throw Error();
  }
}

export function assertOwnerControlledStorage(
  path: string,
  kind: "directory" | "file",
  maximum = 4096,
  access: "private" | "readable" = "private",
) {
  assertStorageMetadata(path, kind, maximum, access);
  if (process.platform === "win32")
    assertWindowsPrivateStorage(
      kind === "directory" ? path : dirname(path),
      kind === "file" ? [path] : [],
    );
  else if (process.platform === "darwin") {
    const acl = spawnSync("/bin/ls", ["-lde", path], {
      encoding: "utf8",
      timeout: 4000,
      maxBuffer: 8192,
      env: { PATH: "/usr/bin:/bin" },
    });
    if (
      acl.status !== 0 ||
      !/^[d-][rwx-]{9}@? /.test(acl.stdout) ||
      acl.stdout.trim().split("\n").length !== 1
    )
      throw Error();
  }
}
export function assertPrivateAuthStorage(
  path: string,
  kind: "directory" | "file",
  maximum = 4096,
) {
  assertOwnerControlledStorage(path, kind, maximum, "private");
}
