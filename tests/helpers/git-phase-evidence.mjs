// Test-only native Git evidence; no production repository or credentials.
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  openSync,
  readSync,
  closeSync,
  lstatSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      if (line.trim() === "") continue;
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
/** Preserve the native call and five-second fixture deadline on every path. */
export function observedFixturePush(command, args, options) {
  let directory, path;
  try {
    directory = mkdtempSync(join(tmpdir(), "required-git-trace-"));
    path = join(directory, "events.jsonl");
  } catch {
    /* Missing diagnostics cannot prevent the original command. */
  }
  const started = performance.now();
  let result;
  try {
    result = spawnSync(
      command,
      args,
      path
        ? { ...options, env: { ...options.env, GIT_TRACE2_EVENT: path } }
        : options,
    );
    return result;
  } finally {
    let evidence = { traceAvailable: false, readFailed: true, events: [] };
    try {
      if (path) evidence = readTrace(path);
    } catch {
      /* retain missing evidence */
    }
    let cleanupFailed = false;
    try {
      if (directory) rmSync(directory, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    try {
      writeSync(
        2,
        "[main-sync-trace2] " +
          JSON.stringify({
            operation: "push",
            elapsedMs: Math.round(performance.now() - started),
            timeoutMs: options.timeout,
            status: result?.status ?? null,
            cleanupFailed,
            ...evidence,
          }) +
          "\n",
      );
    } catch {
      /* Diagnostic write failure cannot replace the native result. */
    }
  }
}
