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
  "Windows host storage works without PowerShell modules or cmdlets",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = fs.realpathSync(
      fs.mkdtempSync(join(tmpdir(), "aios-explicit-modules-")),
    );
    const original = cp.spawnSync;
    let nativeExecutable, nativeArgs, nativeOptions;
    t.mock.method(cp, "spawnSync", (exe, args, options) => {
      nativeExecutable = exe;
      const updated = [...args];
      const index = updated.indexOf("-EncodedCommand") + 1;
      const script =
        "$PSModuleAutoLoadingPreference='None'; function Import-Module { throw 'PowerShell module loading forbidden by native regression' }; function ConvertFrom-Json { throw 'PowerShell JSON cmdlet forbidden by native regression' };\n" +
        Buffer.from(updated[index], "base64").toString("utf16le");
      updated[index] = Buffer.from(script, "utf16le").toString("base64");
      nativeArgs = updated;
      nativeOptions = options;
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
    const large = "é".repeat(65536); // Exactly the 131072-byte public input limit.
    store.write(account, large, true);
    assert.equal(store.read(account), large);

    const registration = join(root, "registration.json");
    const retained = fs.readFileSync(registration);
    const linked = join(root, "linked-registration.json");
    fs.linkSync(registration, linked);
    assert.throws(() => windowsAuthStore(root, [registration]), /unavailable/);
    fs.unlinkSync(linked);
    assert.deepEqual(fs.readFileSync(registration), retained);

    const alias = join(root, "linked-directory");
    fs.symlinkSync(root, alias, "junction");
    assert.throws(() => windowsAuthStore(alias), /unavailable/);
    fs.unlinkSync(alias);

    const unsafe = join(root, "shared-directory");
    fs.mkdirSync(unsafe);
    initializeWindowsAuthDirectory(unsafe);
    windowsAuthStore(unsafe);
    const grant = String.raw`
$ErrorActionPreference='Stop'
try {
 $path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
 $acl=[IO.Directory]::GetAccessControl($path)
 $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow')
 [void]$acl.AddAccessRule($rule)
 [IO.Directory]::SetAccessControl($path,$acl)
} catch { exit 1 }
`;
    const shared = original(
      nativeExecutable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(grant, "utf16le").toString("base64"),
      ],
      {
        input: Buffer.from(unsafe).toString("base64"),
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 8192,
        windowsHide: true,
        shell: false,
        env: { SystemRoot: process.env.SystemRoot },
      },
    );
    assert.equal(
      shared.status,
      0,
      "synthetic ACL grant must succeed before denial",
    );
    assert.throws(() => windowsAuthStore(unsafe), /unavailable/);
    assert.deepEqual(fs.readdirSync(unsafe), []);

    const check = [
      "check",
      "",
      Buffer.alloc(32).toString("base64"),
      "",
      Buffer.from(root).toString("base64"),
    ];
    const invoke = (input) =>
      original(nativeExecutable, nativeArgs, { ...nativeOptions, input });
    assert.equal(invoke(check.join("\n")).status, 0);
    for (const malformed of [
      check.slice(0, 4).join("\n"),
      ["unknown", ...check.slice(1)].join("\n"),
      [check[0], "!", ...check.slice(2)].join("\n"),
      [
        check[0],
        check[1],
        Buffer.alloc(1).toString("base64"),
        ...check.slice(3),
      ].join("\n"),
      [check[0], ...check.slice(1, 4), "!"].join("\n"),
      ["create", ...check.slice(1, 3), "../escape", check[4]].join("\n"),
      [
        "create",
        ...check.slice(1, 3),
        "registration.json",
        check[4],
        check[4],
      ].join("\n"),
      "x".repeat(524289),
      [...check.slice(0, 4), ...Array(1025).fill(check[4])].join("\n"),
    ])
      assert.notEqual(invoke(malformed).status, 0);
    assert.deepEqual(fs.readFileSync(registration), retained);
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
    timedOut = false,
    malformed = false,
    mismatch = false;
  t.mock.method(cp, "spawnSync", (_exe, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 15000);
    assert.equal(options.windowsHide, true);
    assert.deepEqual(options.env, { SystemRoot: process.env.SystemRoot });
    assert.ok(args.includes("-EncodedCommand"));
    const fields = options.input.split("\n");
    const request =
      fields.length === 1
        ? Buffer.from(fields[0], "base64").toString("utf8")
        : {
            action: fields[0],
            bytes: fields[1],
            entropy: fields[2],
            ...(fields[3] === "" ? {} : { name: fields[3] }),
            paths: fields
              .slice(4)
              .map((value) => Buffer.from(value, "base64").toString("utf8")),
          };
    requests.push(request);
    if (timedOut)
      return {
        status: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "private fixture error",
        error: Object.assign(new Error("private fixture timeout"), {
          code: "ETIMEDOUT",
        }),
      };
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
    timeOut: () => (timedOut = true),
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

test("Windows storage timeout refuses initialization and checks without retry or writes", (t) => {
  const f = fixture(t);
  f.timeOut();
  const sanitized = (error) =>
    error.message.includes("unavailable") &&
    !error.message.includes("private fixture");
  assert.throws(() => initializeWindowsAuthDirectory(f.root), sanitized);
  assert.equal(f.requests.length, 1);
  assert.throws(() => windowsAuthStore(f.root), sanitized);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(fs.readdirSync(f.root), []);
});
