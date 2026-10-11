import assert from "node:assert/strict";
import { test } from "node:test";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  linkSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCodexMediation } from "../dist/codex-mediation.js";

for (const [platform, arch] of [
  ["darwin", "arm64"],
  ["win32", "x64"],
]) {
  test(`supported ${platform} host refuses unpinned, linked and candidate-owned executables`, async (t) => {
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    const originalArch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { value: platform });
    Object.defineProperty(process, "arch", { value: arch });
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "aios-mediation-refusal-")),
    );
    t.after(() => {
      Object.defineProperty(process, "platform", originalPlatform);
      Object.defineProperty(process, "arch", originalArch);
      rmSync(root, { recursive: true, force: true });
    });
    const repo = join(root, "repo"),
      authority = join(root, "state");
    mkdirSync(repo);
    mkdirSync(authority);
    const executable = join(root, "untrusted");
    writeFileSync(executable, "not the pinned Codex binary", { mode: 0o700 });
    const candidate = join(repo, "codex"),
      ledger = join(authority, "codex");
    writeFileSync(candidate, "candidate binary");
    writeFileSync(ledger, "authority binary");
    const symbolic = join(root, "alias");
    symlinkSync(executable, symbolic);
    for (const path of [executable, candidate, ledger, symbolic, repo]) {
      const report = await inspectCodexMediation(path, repo, authority);
      assert.equal(report.protocol, "not-run");
      assert.equal(report.qualified, false);
      assert.equal(report.executableSha256, undefined);
    }
    const hard = join(root, "hard");
    linkSync(executable, hard);
    assert.equal(
      (await inspectCodexMediation(executable, repo, authority)).protocol,
      "not-run",
    );
  });
}
