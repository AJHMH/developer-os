import { writeFileSync, unlinkSync } from "node:fs";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { codexSubscriptionReader } from "../dist/codex-usage.js";

const fixtureBytes = "synthetic pinned Codex fixture";
const fakeExecutable = {
  path: resolve("synthetic-codex"),
  sha256: createHash("sha256").update(fixtureBytes).digest("hex"),
};
function transport(t, mode, limits) {
  writeFileSync(fakeExecutable.path, fixtureBytes, { mode: 0o700 });
  t.after(() => {
    try {
      unlinkSync(fakeExecutable.path);
    } catch {}
  });
  const messages = [];
  let killed = false;
  t.mock.method(childProcess, "spawn", (executable, args, options) => {
    assert.equal(executable, resolve("synthetic-codex"));
    assert.deepEqual(args, ["app-server"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.kill = () => {
      killed = true;
      child.emit("exit", 0);
      child.emit("close", 0);
    };
    child.stdin.on("data", (bytes) => {
      const request = JSON.parse(bytes.toString());
      messages.push(request);
      queueMicrotask(() => {
        if (killed) return;
        if (mode === "malformed") {
          child.stdout.write("malformed protocol data\n");
          return;
        }
        if (mode === "oversized") {
          child.stdout.write(Buffer.alloc(256 * 1024 + 1));
          return;
        }
        if (mode === "stdin-error") {
          child.stdin.emit("error", new Error("synthetic-private-error"));
          return;
        }
        if (mode === "transport-error") {
          child.emit("error", new Error("synthetic-private-error"));
          return;
        }
        if (mode === "rpc-error") {
          child.stdout.write(
            JSON.stringify({
              id: request.id,
              error: { message: "synthetic-private-error" },
            }) + "\n",
          );
          return;
        }
        if (request.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (request.id === 2)
          child.stdout.write(
            JSON.stringify({
              id: 2,
              result: {
                account: {
                  type: mode === "api-account" ? "apiKey" : "chatgpt",
                  email:
                    mode === "invalid-email" ? 7 : "synthetic@example.invalid",
                },
              },
            }) + "\n",
          );
        if (request.id === 3)
          child.stdout.write(JSON.stringify({ id: 3, result: limits }) + "\n");
      });
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { messages, stopped: () => killed };
}

test("subscription reader requests only read-only account and limit observations and hashes account identity", async (t) => {
  const now = Math.floor(Date.now() / 1000) + 3600;
  const fake = transport(t, "valid", {
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        rateLimitReachedType: "primary",
        primary: { usedPercent: 100, resetsAt: now },
        secondary: { usedPercent: 25, resetsAt: now },
      },
    },
  });
  const report = await codexSubscriptionReader(fakeExecutable)();
  assert.equal(report.authMode, "chatgpt");
  assert.equal(
    report.accountId,
    createHash("sha256").update("synthetic@example.invalid").digest("hex"),
  );
  assert.equal(report.exhausted, true);
  assert.deepEqual(report.windows, [
    { id: "codex:primary", usedPercent: 100, resetsAt: now },
    { id: "codex:secondary", usedPercent: 25, resetsAt: now },
  ]);
  assert.deepEqual(
    fake.messages.map((message) => message.method),
    ["initialize", "initialized", "account/read", "account/rateLimits/read"],
  );
  assert.deepEqual(
    fake.messages.find((message) => message.method === "account/read").params,
    { refreshToken: false },
  );
  assert.equal(fake.stopped(), true);
  assert.equal(
    JSON.stringify(report).includes("synthetic@example.invalid"),
    false,
  );
});

test("subscription reader supports the legacy limits response without fabricating absent windows", async (t) => {
  const fake = transport(t, "valid", {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 12, resetsAt: 2000000000 },
      secondary: null,
    },
  });
  const report = await codexSubscriptionReader(fakeExecutable)();
  assert.equal(report.exhausted, false);
  assert.deepEqual(report.windows, [
    { id: "codex:primary", usedPercent: 12, resetsAt: 2000000000 },
  ]);
  assert.equal(fake.stopped(), true);
});

for (const mode of [
  "malformed",
  "oversized",
  "transport-error",
  "rpc-error",
  "api-account",
  "invalid-limits",
  "invalid-email",
  "stdin-error",
]) {
  test(`subscription reader refuses ${mode} without returning private diagnostics`, async (t) => {
    const fake = transport(t, mode, {
      rateLimitsByLimitId: {
        bad:
          mode === "invalid-limits"
            ? { limitId: 7 }
            : {
                limitId: "codex",
                primary: { usedPercent: 1, resetsAt: 2000000000 },
              },
      },
    });
    assert.equal(await codexSubscriptionReader(fakeExecutable)(), undefined);
    assert.equal(fake.stopped(), true);
  });
}

test("subscription reader refuses a relative executable without launching a transport", async (t) => {
  const fake = transport(t, "valid", {});
  assert.equal(await codexSubscriptionReader("synthetic-codex")(), undefined);
  assert.equal(fake.messages.length, 0);
});

test("subscription reader handles a null modern-limit inventory through the legacy response", async (t) => {
  transport(t, "valid", {
    rateLimitsByLimitId: null,
    rateLimits: {
      limitId: "codex",
      primary: null,
      secondary: { usedPercent: 8, resetsAt: 2000000000 },
    },
  });
  const report = await codexSubscriptionReader(fakeExecutable)();
  assert.deepEqual(report.windows, [
    { id: "codex:secondary", usedPercent: 8, resetsAt: 2000000000 },
  ]);
});

test("subscription reader refuses a missing limit bucket rather than returning fabricated usage", async (t) => {
  transport(t, "valid", { rateLimitsByLimitId: { missing: null } });
  assert.equal(await codexSubscriptionReader(fakeExecutable)(), undefined);
});
