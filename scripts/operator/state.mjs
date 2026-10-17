import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export class OperatorRefusal extends Error {}
export function requireValue(condition, message) {
  if (!condition) throw new OperatorRefusal(message);
}
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function within(parent, child) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep))
  );
}
export function privateFile(path) {
  const info = lstatSync(path);
  requireValue(
    info.isFile() && info.nlink === 1 && info.size <= 16 * 1024 * 1024,
    "State/input must be a bounded ordinary single-link file",
  );
  if (process.platform !== "win32")
    requireValue(
      info.uid === process.getuid() && (info.mode & 0o077) === 0,
      "Private input permissions required",
    );
}
export function stateDirectory(path, repository) {
  requireValue(
    process.platform !== "win32",
    "Native Windows private state is not qualified; ACL verification required",
  );
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    checkOutside(join(realpathSync(dirname(absolute)), basename(absolute)));
    mkdirSync(absolute, { mode: 0o700 });
  }
  const info = lstatSync(absolute);
  requireValue(
    info.isDirectory() && !info.isSymbolicLink(),
    "Ordinary state directory required",
  );
  if (process.platform !== "win32")
    requireValue(
      info.uid === process.getuid() && (info.mode & 0o077) === 0,
      "Private state directory permissions required",
    );
  const actual = realpathSync(absolute);
  checkOutside(actual);
  return actual;
  function checkOutside(candidate) {
    requireValue(
      !within(realpathSync(repository), candidate),
      "State must be outside the source repository",
    );
  }
}
export function readState(directory, name) {
  const path = join(directory, name);
  privateFile(path);
  return JSON.parse(readFileSync(path, "utf8"));
}
export function writeState(directory, name, value) {
  const path = join(directory, name);
  if (existsSync(path)) privateFile(path);
  const temporary = join(directory, ".pending-" + randomUUID());
  const serialized = JSON.stringify(value, null, 2) + "\n";
  requireValue(
    Buffer.byteLength(serialized) <= 16 * 1024 * 1024,
    "State size limit exceeded; previous record preserved",
  );
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, serialized);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    // Windows does not support opening directories for fsync.
    if (process.platform !== "win32") {
      const parent = openSync(directory, "r");
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}
export async function locked(directory, work) {
  const path = join(directory, ".operator-lock");
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, operation: randomUUID() }),
    );
    fsyncSync(fd);
    return await work();
  } finally {
    closeSync(fd);
    rmSync(path);
  }
}
export function argumentsOf(argv, allowed) {
  requireValue(argv.length % 2 === 0, "Expected --name value pairs");
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    requireValue(
      /^--[a-z][a-z-]*$/.test(argv[i]) && !(argv[i].slice(2) in result),
      "Invalid or duplicate option",
    );
    if (allowed)
      requireValue(allowed.includes(argv[i].slice(2)), "Unknown option");
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}
