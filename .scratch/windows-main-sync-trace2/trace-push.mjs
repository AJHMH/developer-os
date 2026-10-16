// Explicit external-process probe; never loaded by normal tests or application code.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtempSync,
  openSync,
  readSync,
  closeSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "main-sync-trace2-"));
const original = cp.spawnSync;
let sequence = 0;
const eventNames = [
  "start",
  "cmd_name",
  "child_start",
  "child_exit",
  "region_enter",
  "region_leave",
  "exit",
  "atexit",
];
const commands = [
  "push",
  "receive-pack",
  "pack-objects",
  "index-pack",
  "unpack-objects",
];
const categories = [
  "transport_push",
  "transport",
  "pack-objects",
  "pack",
  "progress",
  "refs",
  "index",
  "unpack_trees",
  "protocol",
  "negotiation",
];
function readTrace(path) {
  let fd;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw Error("unsafe trace");
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(65536);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    const events = [],
      processes = new Map();
    let malformedLines = 0;
    const text = buffer.subarray(0, size).toString("utf8");
    const lines = text.split("\n");
    if (!text.endsWith("\n")) lines.pop();
    for (const line of lines) {
      if (events.length >= 128) break;
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        malformedLines++;
        continue;
      }
      if (!eventNames.includes(item.event)) continue;
      if (!processes.has(item.sid)) processes.set(item.sid, processes.size);
      const event = { event: item.event, process: processes.get(item.sid) };
      for (const key of ["t_abs", "t_rel", "code", "child_id"])
        if (typeof item[key] === "number" && Number.isFinite(item[key]))
          event[key] = item[key];
      if (item.event === "cmd_name")
        event.command = commands.includes(item.name) ? item.name : "other";
      if (["region_enter", "region_leave"].includes(item.event))
        event.category = categories.includes(item.category)
          ? item.category
          : "other";
      events.push(event);
    }
    return {
      traceAvailable: events.length > 0,
      bytesRead: size,
      truncated: stat.size > size || events.length >= 128,
      malformedLines,
      events,
    };
  } catch {
    return { traceAvailable: false, readFailed: true, events: [] };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* A diagnostic close failure cannot change the command result. */
      }
    }
  }
}
cp.spawnSync = (command, args, options) => {
  if (
    command !== "git" ||
    !Array.isArray(args) ||
    !args.includes("push") ||
    !args.includes("core.attributesFile=/nonexistent") ||
    !args.includes("user.email=fixture@example.invalid")
  )
    return original(command, args, options);
  const path = join(directory, `${++sequence}.jsonl`);
  const started = performance.now();
  const result = original(command, args, {
    ...options,
    env: { ...(options?.env ?? process.env), GIT_TRACE2_EVENT: path },
  });
  console.error(
    "[main-sync-trace2] " +
      JSON.stringify({
        operation: "push",
        elapsedMs: Math.round(performance.now() - started),
        timeoutMs: options?.timeout ?? null,
        status: result.status,
        ...readTrace(path),
      }),
  );
  return result;
};
syncBuiltinESMExports();
process.on("exit", () => {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    console.error('[main-sync-trace2-cleanup] {"failed":true}');
  }
});
