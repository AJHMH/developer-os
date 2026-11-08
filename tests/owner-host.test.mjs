import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ownerHostRefusal, supportsOwnerHost } from "../dist/host-target.js";
import { testEnvironment } from "../scripts/run-tests.mjs";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const status = (t, env) => {
  const state = realpathSync(mkdtempSync(join(tmpdir(), "aios-owner-host-")));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  return spawnSync(process.execPath, [cli, "status", "--state-dir", state], {
    encoding: "utf8",
    env,
  });
};

test("only macOS is an owner host", () => {
  assert.equal(supportsOwnerHost("darwin"), true);
  for (const platform of ["linux", "win32", "freebsd", undefined, ""])
    assert.equal(supportsOwnerHost(platform), false, String(platform));
});

test("the CLI refuses to start on any host but macOS, before reading state", (t) => {
  for (const platform of ["linux", "win32", "freebsd"]) {
    const result = status(t, {
      ...process.env,
      AIOS_TEST_HOST_PLATFORM: platform,
    });
    assert.equal(result.status, 1, platform);
    assert.equal(result.stdout, "", platform);
    assert.deepEqual(JSON.parse(result.stderr), { error: ownerHostRefusal });
  }
});

test("the CLI meets the real host check when nothing stands in for the Mac", (t) => {
  const env = { ...process.env };
  delete env.AIOS_TEST_HOST_PLATFORM;
  const result = status(t, env);
  if (process.platform === "darwin") assert.equal(result.status, 0);
  else {
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), { error: ownerHostRefusal });
  }
});

test("the suite stands in for the Mac only off macOS", () => {
  assert.equal(testEnvironment("darwin").AIOS_TEST_HOST_PLATFORM, undefined);
  assert.equal(testEnvironment("linux").AIOS_TEST_HOST_PLATFORM, "darwin");
});
