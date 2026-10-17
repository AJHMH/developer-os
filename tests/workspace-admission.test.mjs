import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitFiles, admittedPath } from "../dist/workspace.js";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("admission retains the bounded, digest-pinned ordinary file boundary", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-admission-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "file.txt"), "safe");
  const policy = { files: [{ path: "file.txt", sha256: digest("safe") }] };
  assert.equal(admitFiles(policy, repo)[0].bytes.toString(), "safe");
  assert.throws(() =>
    admitFiles({ files: [...policy.files, ...policy.files] }, repo),
  );
  writeFileSync(join(repo, "file.txt"), "changed");
  assert.throws(() => admitFiles(policy, repo));
  for (const path of [
    "../secret",
    ".env",
    "nested/.ssh/id_rsa",
    "private.pem",
    "C:\\secret",
    "CON",
    "trailing.",
  ])
    assert.equal(admittedPath(path), false);
  linkSync(join(repo, "file.txt"), join(repo, "hardlink"));
  assert.throws(() =>
    admitFiles(
      { files: [{ path: "hardlink", sha256: digest("changed") }] },
      repo,
    ),
  );
  if (process.platform !== "win32") {
    symlinkSync(join(repo, "file.txt"), join(repo, "symlink"));
    assert.throws(() =>
      admitFiles(
        { files: [{ path: "symlink", sha256: digest("changed") }] },
        repo,
      ),
    );
    symlinkSync(repo, join(root, "linked-directory"));
    assert.throws(() => admitFiles(policy, join(root, "linked-directory")));
  }
});
