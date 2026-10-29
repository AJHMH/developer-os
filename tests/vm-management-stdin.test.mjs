import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostTargets } from "../dist/host-target.js";
import { VMManagementChannel } from "../dist/vm-management.js";

// A local stand-in for `podman machine ssh … python3`: it answers the engine
// version query, then reads all of stdin with Python's readall, the reader
// that piped spawnSync `input` just over 64 KiB can leave without EOF on macOS.
test(
  "native management delivers its over-64 KiB program whole through a private stdin file",
  { skip: process.platform === "win32" && "POSIX stand-in engine" },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), "aios-management-stdin-"));
    const scratch = join(root, "tmp");
    mkdirSync(scratch);
    const previous = process.env.TMPDIR;
    t.after(() => {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      rmSync(root, { recursive: true, force: true });
    });
    const executable = join(root, "podman");
    writeFileSync(
      executable,
      `#!/bin/sh
if [ "$1" = "--connection" ]; then echo '{"Client":{"Version":"6.1.1"}}'; exit 0; fi
exec ${process.env.AIOS_TEST_PYTHON || "python3"} -I -c 'import sys,json,hashlib,os
d=sys.stdin.buffer.read()
print(json.dumps(dict(sha256=hashlib.sha256(d).hexdigest(),bytes=len(d))))
sys.exit(1 if os.environ.get("FAIL") else 0)'
`,
      { mode: 0o755 },
    );
    const channel = (env = {}) =>
      new VMManagementChannel("aios-test", join(root, "authority"), () => ({
        ...hostTargets.darwin,
        osVersion: "27.2.0",
        executable,
        cwd: root,
        env: { PATH: process.env.PATH, ...env },
        managementMs: 10000,
        config: {},
      }));
    const payload = { expected: { platform: "darwin" } };
    const { input } = channel().prepare("observe", payload);
    assert.ok(Buffer.byteLength(input) > 65536, "program exceeds 64 KiB");
    const expected = {
      sha256: createHash("sha256").update(input).digest("hex"),
      bytes: Buffer.byteLength(input),
    };
    // The private program files land here and must be gone after each call.
    process.env.TMPDIR = scratch;
    for (let i = 0; i < 40; i++)
      assert.deepEqual(channel().invoke("observe", payload), expected);
    assert.throws(
      () => channel({ FAIL: "1" }).invoke("observe", payload),
      /^Error: Native offline operation unavailable$/,
    );
    assert.deepEqual(readdirSync(scratch), []);
  },
);
