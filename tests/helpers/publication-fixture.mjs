import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SplitPublicationAdapter } from "../../dist/publication-adapter.js";

export function signedFixture(f) {
  const bare = join(f.root, "trusted-git"),
    remote = join(f.root, "remote.git"),
    empty = join(f.root, "empty");
  const key = join(f.root, "fixture-key"),
    allowed = join(f.root, "allowed-signers");
  mkdirSync(empty);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const name of Object.keys(env))
    if (
      name.startsWith("GIT_CONFIG_COUNT") ||
      name.startsWith("GIT_CONFIG_KEY_") ||
      name.startsWith("GIT_CONFIG_VALUE_")
    )
      delete env[name];
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, {
      env,
      encoding: "utf8",
      input,
      timeout: 10000,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  run("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", key]);
  writeFileSync(
    allowed,
    "fixture@example.invalid " + readFileSync(key + ".pub", "utf8"),
  );
  run("git", ["init", "--bare", "--template=" + empty, bare]);
  run("git", ["init", "--bare", "--template=" + empty, remote]);
  const git = (args, input) =>
    run(
      "git",
      [
        "--git-dir",
        bare,
        "-c",
        "core.hooksPath=" + empty,
        "-c",
        "core.attributesFile=" +
          (process.platform === "win32" ? "NUL" : "/dev/null"),
        "-c",
        "gpg.format=ssh",
        "-c",
        "user.signingkey=" + key,
        "-c",
        "gpg.ssh.allowedSignersFile=" + allowed,
        "-c",
        "protocol.file.allow=always",
        ...args,
      ],
      input,
    );
  git(["fetch", "--no-tags", f.repository, "HEAD"]);
  const signed = new Map(),
    branches = new Map(),
    prs = new Map();
  const Git = {
    async inspect() {
      return {
        repository: "AJHMH/profile-page",
        login: "aaron-howard",
        signingKeySha256: "1".repeat(64),
        signingAvailable: true,
        publicationAllowed: true,
      };
    },
    async sign(r) {
      assert.equal(r.controls.hooks, false);
      assert.equal(r.controls.signWithAppPem, false);
      assert.equal(r.controls.candidateConfiguration, false);
      assert.equal(r.mayDispatch(), true);
      // Test fixture currently has one flat ordinary file; real Git computes the tree independently.
      const entries = r.files
        .map((file) => {
          assert.equal(file.path.includes("/"), false);
          const blob = git(["hash-object", "-w", "--stdin"], file.bytes);
          return (
            (file.executable ? "100755" : "100644") +
            " blob " +
            blob +
            "\t" +
            file.path +
            "\n"
          );
        })
        .join("");
      const tree = git(["mktree"], entries);
      assert.equal(tree, r.publication.treeSha1);
      const commit = git([
        "commit-tree",
        tree,
        "-p",
        r.publication.sourceRevision,
        "-S",
        "-m",
        "Validated fixture",
      ]);
      signed.set(r.effect.id, commit);
      return { commit };
    },
    async verifyLocal(r) {
      git(["verify-commit", r.commit]);
      return {
        commit: r.commit,
        tree: git(["show", "-s", "--format=%T", r.commit]),
        parent: git(["show", "-s", "--format=%P", r.commit]),
        signer: "aaron-howard",
        localVerified: true,
      };
    },
    async push(r) {
      assert.equal(r.mayDispatch(), true);
      assert.equal(r.expectedRemoteHead, null);
      git([
        "push",
        "--force-with-lease=refs/heads/" + r.publication.branch + ":",
        remote,
        r.publication.commit + ":refs/heads/" + r.publication.branch,
      ]);
      branches.set(r.publication.branch, r.publication.commit);
    },
    async findSigned(r) {
      const commit = signed.get(r.effect.id);
      return commit
        ? { state: "found", result: { commit } }
        : { state: "absent", quiescent: true };
    },
    async observeRemote(r) {
      const commit = branches.get(r.publication.branch);
      if (!commit) return { state: "absent", quiescent: true };
      // Local remote exercises push/object identity; GitHub verification is controlled evidence.
      return {
        state: "found",
        result: {
          commit,
          tree: git(["show", "-s", "--format=%T", commit]),
          repository: r.publication.repository,
          branch: r.publication.branch,
          githubVerified: true,
          signer: "aaron-howard",
          publisher: "aaron-howard",
        },
      };
    },
  };
  const App = {
    async inspect() {
      return {
        repository: "AJHMH/profile-page",
        login: "factory[bot]",
        keySha256: "2".repeat(64),
        permissions: ["pull_requests:write"],
        approver: "aaron-howard",
        eligibleApprovers: ["aaron-howard"],
      };
    },
    async create(r) {
      assert.equal(r.mayDispatch(), true);
      assert.equal("files" in r, false);
      assert.equal("controls" in r, false);
      prs.set(r.operationId, {
        number: 1,
        repository: r.repository,
        head: r.head,
        branch: r.branch,
        base: r.base,
        author: "factory[bot]",
        approver: r.approver,
      });
    },
    async observe(r) {
      const result = prs.get(r.operationId);
      return result
        ? { state: "found", result }
        : { state: "absent", quiescent: true };
    },
  };
  return {
    runtime: new SplitPublicationAdapter("f".repeat(64), Git, App),
    Git,
    App,
    git,
    remote,
  };
}
