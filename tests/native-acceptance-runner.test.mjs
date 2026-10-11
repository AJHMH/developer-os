import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const runner = resolve("scripts/run-native-acceptance.mjs");
function invoke(state, scripts, args = []) {
  const child = spawn(process.execPath, [
    runner,
    state,
    ...scripts,
    "--",
    ...args,
  ]);
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  return {
    child,
    done: new Promise((resolve) =>
      child.on("close", (code) => resolve({ code, output })),
    ),
  };
}

test("native acceptance steps finish in order and receive the supplied arguments", async () => {
  const root = mkdtempSync(join(tmpdir(), "acceptance-runner-"));
  try {
    const log = join(root, "order");
    const first = join(root, "first.mjs"),
      second = join(root, "second.mjs");
    writeFileSync(
      first,
      `import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], 'first-start\\n'); await new Promise(r => setTimeout(r, 50)); appendFileSync(process.argv[2], 'first-end\\n');`,
    );
    writeFileSync(
      second,
      `import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], 'second\\n');`,
    );
    const result = await invoke(root, [first, second], [log]).done;
    assert.equal(result.code, 0, result.output);
    assert.equal(readFileSync(log, "utf8"), "first-start\nfirst-end\nsecond\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a concurrent runner using an aliased state path refuses before launching a step", async () => {
  const root = mkdtempSync(join(tmpdir(), "acceptance-runner-"));
  const { symlinkSync } = await import("node:fs");
  const { once } = await import("node:events");
  let running;
  try {
    const script = join(root, "held.mjs");
    writeFileSync(
      script,
      "console.log('started'); await new Promise(r => setTimeout(r, 500));",
    );
    running = invoke(root, [script]);
    await once(running.child.stdout, "data");
    const alias = join(root, "alias");
    symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
    const blocked = await invoke(alias, [script]).done;
    assert.notEqual(blocked.code, 0, blocked.output);
    assert.match(blocked.output, /acceptance.*lock/i);
    running.child.stdin.end();
    assert.equal((await running.done).code, 0);
    const retry = join(root, "retry.mjs");
    writeFileSync(retry, "process.exit(0);");
    assert.equal((await invoke(root, [retry]).done).code, 0);
  } finally {
    running?.child.stdin.end();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed step stops the run and releases its lock for a retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "acceptance-runner-"));
  try {
    const failed = join(root, "failed.mjs"),
      later = join(root, "later.mjs");
    const log = join(root, "later-ran");
    writeFileSync(failed, "process.exit(7);");
    writeFileSync(
      later,
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], 'ran');",
    );
    const result = await invoke(root, [failed, later], [log]).done;
    assert.equal(result.code, 7, result.output);
    assert.throws(() => readFileSync(log), { code: "ENOENT" });
    const retry = await invoke(root, [later], [log]).done;
    assert.equal(retry.code, 0, retry.output);
    assert.equal(readFileSync(log, "utf8"), "ran");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interruption retains the lock and refuses a later run", async () => {
  const root = mkdtempSync(join(tmpdir(), "acceptance-runner-"));
  const { once } = await import("node:events");
  let running;
  try {
    const script = join(root, "held.mjs");
    writeFileSync(
      script,
      "console.log('started'); await new Promise(r => setTimeout(r, 1000));",
    );
    running = invoke(root, [script]);
    await once(running.child.stdout, "data");
    running.child.kill("SIGTERM");
    const stopped = await running.done;
    assert.notEqual(stopped.code, 0);
    // Windows forcefully terminates the process; it cannot print a signal-handler message.
    if (process.platform !== "win32")
      assert.match(stopped.output, /lock retained/i);
    const blocked = await invoke(root, [script]).done;
    assert.notEqual(blocked.code, 0);
    assert.match(blocked.output, /acceptance.*lock/i);
    assert.doesNotMatch(blocked.output, /started/);
  } finally {
    running?.child.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
