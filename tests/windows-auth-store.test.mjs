import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  windowsAuthStore,
  initializeWindowsAuthDirectory,
} from "../dist/windows-auth-store.js";

test(
  "Windows host storage works with implicit module loading disabled",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = fs.realpathSync(
      fs.mkdtempSync(join(tmpdir(), "aios-explicit-modules-")),
    );
    const original = cp.spawnSync;
    t.mock.method(cp, "spawnSync", (exe, args, options) => {
      const updated = [...args];
      const index = updated.indexOf("-EncodedCommand") + 1;
      const script =
        "$PSModuleAutoLoadingPreference='None';\n" +
        Buffer.from(updated[index], "base64").toString("utf16le");
      updated[index] = Buffer.from(script, "utf16le").toString("base64");
      return original(exe, updated, options);
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(root, { recursive: true, force: true });
    });
    initializeWindowsAuthDirectory(root);
    const store = windowsAuthStore(root);
    const account = "e".repeat(64);
    store.createRegistration('{"synthetic":true}');
    windowsAuthStore(root, [join(root, "registration.json")]);
    assert.throws(() => store.createRegistration("{}"), /unavailable/);
    store.write(account, "fixed synthetic account", false);
    assert.equal(store.read(account), "fixed synthetic account");
    store.write(account, "fixed synthetic replacement", true);
    assert.equal(store.read(account), "fixed synthetic replacement");
  },
);

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "synthetic-auth-store-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const descriptors = Object.fromEntries(
    ["platform", "arch"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(process, k),
    ]),
  );
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  Object.defineProperty(process, "arch", { value: "x64", configurable: true });
  const requests = [];
  let refused = false,
    malformed = false,
    mismatch = false;
  t.mock.method(cp, "spawnSync", (_exe, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.deepEqual(options.env, { SystemRoot: process.env.SystemRoot });
    assert.ok(args.includes("-EncodedCommand"));
    const request = JSON.parse(options.input);
    requests.push(request);
    if (typeof request === "string")
      return { status: refused ? 1 : 0, stdout: "" };
    assert.equal(request.paths[0], root);
    assert.match(request.entropy, /^[A-Za-z0-9+/]+={0,2}$/);
    if (refused) return { status: 1, stdout: "private fixture error" };
    if (malformed) return { status: 0, stdout: "not base64!" };
    // Fixed synthetic transformation, never a call to DPAPI or real accounts.
    const input = Buffer.from(request.bytes, "base64");
    if (request.action === "create") {
      fs.writeFileSync(join(root, request.name), input, { flag: "wx" });
      return { status: 0, stdout: Buffer.from("OK").toString("base64") };
    }
    const bytes =
      request.action === "check"
        ? Buffer.from("OK")
        : request.action === "protect"
          ? Buffer.concat([Buffer.from("fixed:"), input])
          : mismatch
            ? Buffer.from("changed")
            : input.subarray(6);
    return { status: 0, stdout: bytes.toString("base64") };
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const [k, d] of Object.entries(descriptors))
      Object.defineProperty(process, k, d);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    root,
    requests,
    refuse: () => (refused = true),
    malform: () => (malformed = true),
    mismatch: () => (mismatch = true),
  };
}
test("Windows new-file creation preserves existing registration and replacement collisions", (t) => {
  const f = fixture(t);
  const store = windowsAuthStore(f.root);
  for (const value of ["", "x".repeat(4097)])
    assert.throws(() => store.createRegistration(value), /unavailable/);
  store.createRegistration('{"fixed":"synthetic"}');
  const registration = join(f.root, "registration.json");
  const retained = fs.readFileSync(registration);
  assert.throws(() => store.createRegistration("{}"));
  assert.deepEqual(fs.readFileSync(registration), retained);
  const account = "f".repeat(64);
  store.write(account, "fixed retained account", false);
  const staging = join(f.root, account + ".replace");
  fs.writeFileSync(staging, "fixed retained staging");
  assert.throws(() => store.write(account, "fixed replacement", true));
  assert.equal(fs.readFileSync(staging, "utf8"), "fixed retained staging");
  assert.equal(store.read(account), "fixed retained account");
});
test("Windows protected store scopes synthetic encryption and verifies create/replace before readback", (t) => {
  const f = fixture(t);
  initializeWindowsAuthDirectory(f.root);
  const metadata = join(f.root, "host-registration.json");
  fs.writeFileSync(metadata, "{}");
  const store = windowsAuthStore(f.root, [metadata]);
  const account = "a".repeat(64);
  store.write(account, "synthetic-first", false);
  assert.equal(store.read(account), "synthetic-first");
  assert.throws(() => store.write(account, "wrong replacement mode", false));
  store.write(account, "synthetic-second", true);
  assert.equal(store.read(account), "synthetic-second");
  assert.equal(fs.existsSync(join(f.root, account + ".replace")), false);
  assert.throws(() => store.write("b".repeat(64), "absent", true));
  for (const value of ["", "x".repeat(131073)])
    assert.throws(() => store.write("b".repeat(64), value, false));
  assert.throws(() => store.read("malformed"));
  assert.throws(() => store.write("malformed", "fixed", false));
  assert.deepEqual(f.requests[1].paths, [f.root, metadata]);
  assert.notEqual(
    f.requests.find((r) => r.action === "protect").entropy,
    f.requests[1].entropy,
  );
});
test("Windows protected store rejects changed files and sanitizes host encryption refusals", (t) => {
  const f = fixture(t);
  const store = windowsAuthStore(f.root);
  const account = "c".repeat(64);
  store.write(account, "synthetic-only", false);
  const original = fs.lstatSync;
  const observation = t.mock.method(fs, "lstatSync", (path) =>
    String(path).endsWith(".dpapi")
      ? { isFile: () => true, isSymbolicLink: () => false, nlink: 2, size: 10 }
      : original(path),
  );
  syncBuiltinESMExports();
  assert.throws(() => store.read(account), /unavailable/);
  observation.mock.restore();
  syncBuiltinESMExports();
  f.refuse();
  assert.throws(
    () => store.read(account),
    (error) => !error.message.includes("private fixture"),
  );
  assert.throws(() => initializeWindowsAuthDirectory(f.root), /unavailable/);
});
test("Windows protected store refuses malformed host output and changed readback", (t) => {
  const f = fixture(t);
  const store = windowsAuthStore(f.root);
  f.mismatch();
  assert.throws(
    () => store.write("d".repeat(64), "synthetic-only", false),
    /unavailable/,
  );
  f.malform();
  assert.throws(() => windowsAuthStore(f.root), /unavailable/);
});

test("Windows protected storage refuses path drift and cleans failed replacement without changing retained bytes", (t) => {
  const f = fixture(t);
  const store = windowsAuthStore(f.root);
  const account = "e".repeat(64);
  store.write(account, "synthetic-retained", false);
  t.mock.method(fs, "renameSync", () => {
    throw Error("synthetic rename refused");
  });
  syncBuiltinESMExports();
  assert.throws(
    () => store.write(account, "synthetic-new", true),
    /rename refused/,
  );
  assert.equal(fs.existsSync(join(f.root, account + ".replace")), false);
  assert.equal(store.read(account), "synthetic-retained");
  const real = fs.realpathSync;
  t.mock.method(fs, "realpathSync", (path) =>
    path === f.root ? f.root + "-drift" : real(path),
  );
  syncBuiltinESMExports();
  assert.throws(() => windowsAuthStore(f.root), /unavailable/);
});
test("Windows protected storage refuses unsupported architectures and uses only the fixed OS executable fallback", (t) => {
  const f = fixture(t);
  const retainedRoot = process.env.SystemRoot;
  delete process.env.SystemRoot;
  t.after(() => {
    if (retainedRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = retainedRoot;
  });
  initializeWindowsAuthDirectory(f.root);
  windowsAuthStore(f.root);
  Object.defineProperty(process, "arch", {
    value: "arm64",
    configurable: true,
  });
  assert.throws(() => windowsAuthStore(f.root), /unavailable/);
});
