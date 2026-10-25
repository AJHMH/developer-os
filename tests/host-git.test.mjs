import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

// Windows resolves a bare `git` against the current directory before PATH.
// A relative PATH entry reproduces that lookup on every platform.
test(
  "a git program inside the target repository never runs on the host",
  { skip: process.platform === "win32" },
  (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-host-git-")));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const repository = join(root, "repository");
    const marker = join(root, "planted-git-ran");
    assert.equal(
      spawnSync("git", ["init", "-q", repository], { encoding: "utf8" }).status,
      0,
    );
    writeFileSync(
      join(repository, "git"),
      `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`,
    );
    chmodSync(join(repository, "git"), 0o755);
    const dist = (name) => pathToFileURL(resolve("dist", name)).href;
    const script = `
      const { inspectLocalRepository } = await import(${JSON.stringify(dist("onboarding.js"))});
      const { featureBranchAdvance } = await import(${JSON.stringify(dist("feature-candidate.js"))});
      inspectLocalRepository(process.cwd());
      featureBranchAdvance(process.cwd(), "codex/feature-x", "0".repeat(40));
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: repository,
        env: { ...process.env, PATH: "." + delimiter + process.env.PATH },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
  },
);
